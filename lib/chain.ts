"use client";
import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import {
  Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction,
  type VersionedTransaction, LAMPORTS_PER_SOL, ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, unpackAccount, unpackMint,
} from "@solana/spl-token";
import idl from "./idl.json";
import { walletAdapter, walletAddress, LOCAL_RPC } from "./wallet";
import { PRODUCTION, quoteBuy, quoteSell, minOutput, solAmount, migrationBudget } from "./protocol";
import { migrationAccounts, metadataPda, METADATA_PROGRAM, MAINNET_GENESIS, DEVNET_GENESIS } from "./raydium";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";
export const PROGRAM_ID = new PublicKey((idl as Idl).address);
export const SOL = LAMPORTS_PER_SOL;
const SCALE = 10n ** 18n;
const DECIMALS = 6;

export const SELL_FEE_MIN_BPS = 125;
export const SELL_FEE_MAX_BPS = 500;
export const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "localnet";
export const IS_LOCAL = CLUSTER === "localnet" && LOCAL_RPC(RPC_URL);
const adapter = walletAdapter(IS_LOCAL);
let _conn: Connection | null = null;
let _program: Program | null = null;
export function connection():Connection {return _conn ??= new Connection(RPC_URL.startsWith("/") ? new URL(RPC_URL,window.location.origin).href : RPC_URL,"confirmed");}
export function userAddress():PublicKey {
  const key=walletAddress(IS_LOCAL); if(!key)throw new Error("Connect your wallet first"); return key;
}
export function program():Program {
  return _program ??= new Program(idl as Idl,new AnchorProvider(connection(),adapter as never,{commitment:"confirmed"}));
}
const pda=(seeds:Uint8Array[])=>PublicKey.findProgramAddressSync(seeds,PROGRAM_ID)[0];
export const globalPda=()=>pda([Buffer.from("global")]);
export const curvePda=(mint:PublicKey)=>pda([Buffer.from("curve"),mint.toBuffer()]);
export const solVaultPda=(mint:PublicKey)=>pda([Buffer.from("sol"),mint.toBuffer()]);
export const curveVault=(mint:PublicKey)=>getAssociatedTokenAddressSync(mint,curvePda(mint),true);
export async function balanceSol():Promise<number>{
  return walletAddress(IS_LOCAL)?(await connection().getBalance(userAddress()))/SOL:0;
}
export async function assertTradingNetwork():Promise<void>{
  const genesis=await connection().getGenesisHash();
  if(CLUSTER==="mainnet-beta"){
    if(genesis!==MAINNET_GENESIS||process.env.NEXT_PUBLIC_ENABLE_MAINNET_TRADING!=="true")throw new Error("Mainnet trading is not enabled for this release");
  }else if(CLUSTER==="devnet"){
    if(genesis!==DEVNET_GENESIS)throw new Error("RPC cluster mismatch");
  }else if(!IS_LOCAL||genesis===MAINNET_GENESIS||genesis===DEVNET_GENESIS)throw new Error("Local testing requires a local validator");
  if(CLUSTER==="mainnet-beta"){
    // Never trade against a production deployment initialized with test economics.
    const global=await (program().account as any).global.fetch(globalPda());
    for(const [key,value] of Object.entries(PRODUCTION))if(String(global[key])!==String(value))throw new Error("Unexpected production economics: "+key);
  }
  userAddress();
}
export async function ensureFunds(min = 2): Promise<void> {
  if (!IS_LOCAL) return;
  await assertTradingNetwork();
  if (await connection().getBalance(userAddress()) >= min * SOL) return;
  const sig = await connection().requestAirdrop(userAddress(), 100 * SOL);
  await connection().confirmTransaction(sig, "confirmed");
}

export async function globalExists(): Promise<boolean> {
  return (await connection().getAccountInfo(globalPda())) !== null;
}

// Configuration is initialized explicitly by deployment tooling, never by a browser.
export async function initGlobal(): Promise<void> { return; }

export interface CoinAccount {
  mint: string; creator: string; name: string; symbol: string;
  virtualSol: bigint; virtualToken: bigint; realSol: bigint; realToken: bigint;
  totalSupply: bigint; circulating: bigint; floorVault: bigint; floorScaled: bigint;
  complete: boolean; graduated: boolean; poolTokens: bigint; marketSol: bigint;
  uri: string; initialRealToken: bigint; poolAddress: string;
  sellFeeBps: number; // this coin's sell tax in bps (125..=500)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toCoin = (mint: string, a: any): CoinAccount => ({
  mint, creator: a.creator.toBase58(), name: a.name, symbol: a.symbol,
  virtualSol: BigInt(a.virtualSol.toString()), virtualToken: BigInt(a.virtualToken.toString()),
  realSol: BigInt(a.realSol.toString()), realToken: BigInt(a.realToken.toString()),
  totalSupply: 0n, circulating: BigInt(a.circulating.toString()), floorVault: BigInt(a.floorVault.toString()),
  floorScaled: BigInt(a.floorScaled.toString()), complete: a.complete, graduated: a.graduated,
  poolTokens: 0n, marketSol: 0n, uri: a.uri, initialRealToken: BigInt(a.initialRealToken.toString()),
  poolAddress: a.raydiumPool.toBase58(), sellFeeBps: a.sellFeeBps,
});

// A valid coin's sell tax is clamped on-chain to [125, 500] bps; an account whose
// decoded sellFeeBps falls outside that is a legacy pre-sell-tax curve (its shorter
// layout mis-aligns under the current IDL) — skip it so stale coins never show.
const isLiveCoin = (c: CoinAccount) => c.sellFeeBps >= SELL_FEE_MIN_BPS && c.sellFeeBps <= SELL_FEE_MAX_BPS;

export async function listCoins(): Promise<CoinAccount[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = await (program().account as any).bondingCurve.all();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coins:CoinAccount[]=all.map((x: any)=>toCoin(x.account.mint.toBase58(),x.account)).filter(isLiveCoin);
  // Respect small RPC plan limits and avoid one mint request per card.
  for(let i=0;i<coins.length;i+=5){
    const group=coins.slice(i,i+5),mints=group.map(c=>new PublicKey(c.mint));
    const infos=await connection().getMultipleAccountsInfo(mints);
    for(let j=0;j<group.length;j++){if(!infos[j])throw new Error("Mint unavailable");group[j].totalSupply=unpackMint(mints[j],infos[j]!).supply;}
  }
  return Promise.all(coins.map(c=>withPool(c,true)));
}

export async function getCoin(mint: string): Promise<CoinAccount | null> {
  let key:PublicKey;try{key=new PublicKey(mint);}catch{return null;}
  // Transport failures propagate; they must not be shown as a nonexistent coin.
  const a=await (program().account as any).bondingCurve.fetchNullable(curvePda(key));
  if(!a)return null;
  const coin=toCoin(mint,a);return isLiveCoin(coin)?await withPool(coin):null;
}

async function withPool(c: CoinAccount,supplyLoaded=false): Promise<CoinAccount> {
  if(!supplyLoaded){const mint=new PublicKey(c.mint), mintInfo=await connection().getAccountInfo(mint);
  if(!mintInfo)throw new Error("Mint unavailable");
  c={...c,totalSupply:unpackMint(mint,mintInfo).supply};}
  if (!c.graduated) return c;
  const accounts = migrationAccounts(PROGRAM_ID, new PublicKey(c.mint), adapter.publicKey, CLUSTER === "devnet");
  if (accounts.poolState.toBase58() !== c.poolAddress) throw new Error("Pool address mismatch");
  const [p,a,b] = await connection().getMultipleAccountsInfo([accounts.poolState,accounts.token0Vault,accounts.token1Vault]);
  if (!p?.owner.equals(accounts.cpSwapProgram) || !a || !b) throw new Error("Raydium pool unavailable");
  const x=unpackAccount(accounts.token0Vault,a).amount, y=unpackAccount(accounts.token1Vault,b).amount;
  return {...c, marketSol: accounts.token0Mint.equals(accounts.wsolMint)?x:y, poolTokens:accounts.token0Mint.equals(accounts.wsolMint)?y:x};
}
function tradeAccounts(mint: PublicKey) {
  return {user:userAddress(),global:globalPda(),mint,bondingCurve:curvePda(mint),solVault:solVaultPda(mint),
    curveVault:curveVault(mint),userAta:getAssociatedTokenAddressSync(mint,userAddress()),tokenProgram:TOKEN_PROGRAM_ID,
    associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId};
}
export async function createCoin(name:string,symbol:string,sellFeeBps=125,devBuySol=0,uri=""):Promise<string>{
  await assertTradingNetwork();await ensureFunds();
  if (Buffer.byteLength(name)>32 || Buffer.byteLength(symbol)>10 || !name.trim() || !symbol.trim()) throw new Error("Invalid name or ticker");
  if (!/^(https:\/\/|ipfs:\/\/|ar:\/\/)/.test(uri) || Buffer.byteLength(uri)>200) throw new Error("Provide a permanent metadata JSON URI (max 200 bytes)");
  if (!Number.isInteger(sellFeeBps)||sellFeeBps<125||sellFeeBps>500) throw new Error("Sell tax must be 1.25–5%");
  if (!Number.isFinite(devBuySol)||devBuySol<0) throw new Error("Invalid dev buy");
  const mint=Keypair.generate();
  await program().methods.create(name,symbol,uri,sellFeeBps,new BN((devBuySol===0?0n:solAmount(devBuySol)).toString()))
    .accounts({payer:userAddress(),creator:userAddress(),global:globalPda(),mint:mint.publicKey,bondingCurve:curvePda(mint.publicKey),
      solVault:solVaultPda(mint.publicKey),curveVault:curveVault(mint.publicKey),devAta:getAssociatedTokenAddressSync(mint.publicKey,userAddress()),
      tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId,
      rent:SYSVAR_RENT_PUBKEY,metadata:metadataPda(mint.publicKey),metadataProgram:METADATA_PROGRAM})
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({units:400_000})]).signers([mint]).rpc();
  return mint.publicKey.toBase58();
}
export async function buy(mint:string,sol:number,slippageBps=100):Promise<void>{
  await assertTradingNetwork();await ensureFunds();
  const c=await getCoin(mint);if(!c)throw new Error("Coin state unavailable");
  if(c.complete||c.graduated)throw new Error("Curve complete: migrate or trade on Raydium");
  const amount=solAmount(sol), min=minOutput(quoteBuy(c,amount),slippageBps);
  await program().methods.buy(new BN(String(amount)),new BN(String(min))).accounts(tradeAccounts(new PublicKey(mint))).rpc();
}
export async function sell(mint:string,tokensWhole:number,slippageBps=100):Promise<void>{
  await assertTradingNetwork();
  if(!Number.isFinite(tokensWhole)||tokensWhole<=0||!Number.isSafeInteger(Math.round(tokensWhole*1e6)))throw new Error("Invalid token amount");
  const c=await getCoin(mint);if(!c)throw new Error("Coin state unavailable");
  const amount=BigInt(Math.round(tokensWhole*1e6)),min=minOutput(quoteSell(c,amount),slippageBps);
  const method=c.graduated?program().methods.redeemFloor(new BN(String(amount)),new BN(String(min))):program().methods.sell(new BN(String(amount)),new BN(String(min)));
  await method.accounts(tradeAccounts(new PublicKey(mint))).rpc();
}
export async function migrateCoin(mint:string):Promise<void>{
  await assertTradingNetwork();
  const c=await getCoin(mint);if(!c||!c.complete||c.graduated)throw new Error("Coin is not ready to migrate");
  const supply=await connection().getTokenSupply(new PublicKey(mint));
  migrationBudget(c.realSol,c.floorVault,c.floorScaled,BigInt(supply.value.amount));
  await program().methods.migrateToRaydium(new BN(0)).accounts(migrationAccounts(PROGRAM_ID,new PublicKey(mint),userAddress(),CLUSTER==="devnet"))
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({units:600_000})]).rpc();
}
export async function myTokenBalance(mint:string):Promise<number>{
  if(!walletAddress(IS_LOCAL))return 0;
  try{return Number((await connection().getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(mint),userAddress()))).value.amount)/1e6;}catch{return 0;}
}
export {SCALE,DECIMALS};
