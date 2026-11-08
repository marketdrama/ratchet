import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, LAMPORTS_PER_SOL, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { readFileSync } from "node:fs";
const { BN, AnchorProvider, Program, Wallet } = anchor;
const idl = JSON.parse(readFileSync("../target/idl/ratchet_curve.json","utf8"));
const admin = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(process.env.HOME+"/.config/solana/id.json","utf8"))));
const conn = new Connection("http://127.0.0.1:8899","confirmed");
const prog = new Program(idl, new AnchorProvider(conn, new Wallet(admin), {commitment:"confirmed"}));
const PID = new PublicKey(idl.address);
const pda=(s,p=PID)=>PublicKey.findProgramAddressSync(s,p)[0];
const B=(s)=>Buffer.from(s);
const CPMM = new PublicKey("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb");
const AMM_CONFIG = new PublicKey("5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy");
const FEE_RCVR = new PublicKey("3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");

const global = pda([B("global")]);
if(!(await prog.account.global.fetchNullable(global)))
  await prog.methods.initialize(new BN("2000000000"), new BN("1073000000000000"), new BN("1000000000000"), new BN("1000000000000000"), 125, 0)
    .accounts({admin:admin.publicKey, global, systemProgram:SystemProgram.programId}).rpc();

const mint = Keypair.generate();
const curve = pda([B("curve"), mint.publicKey.toBuffer()]);
const curveVault = getAssociatedTokenAddressSync(mint.publicKey, curve, true);
const adminAta = getAssociatedTokenAddressSync(mint.publicKey, admin.publicKey);
await prog.methods.create("RayMig","RMIG",250,new BN("500000000")).accounts({
  payer:admin.publicKey, creator:admin.publicKey, global, mint:mint.publicKey, bondingCurve:curve, curveVault,
  devAta:adminAta, tokenProgram:TOKEN_PROGRAM_ID, associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,
  systemProgram:SystemProgram.programId, rent:SYSVAR_RENT_PUBKEY }).signers([mint]).rpc();
const acc={user:admin.publicKey,global,mint:mint.publicKey,bondingCurve:curve,curveVault,userAta:adminAta,tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId};
for(let i=0;i<20;i++){ try{ await prog.methods.buy(new BN(String(2*LAMPORTS_PER_SOL)),new BN(0)).accounts(acc).rpc(); }catch{ break; } const cc=await prog.account.bondingCurve.fetch(curve); if(cc.complete)break; }
let c=await prog.account.bondingCurve.fetch(curve);
console.log("complete:", c.complete, "realSol:", Number(c.realSol)/1e9, "floorVault:", Number(c.floorVault)/1e9, "vaultTokens:", Number((await conn.getTokenAccountBalance(curveVault)).value.amount)/1e6);
if(!c.complete){ console.log("FAIL: coin did not complete"); process.exit(1); }

// derive Raydium accounts; order token_0<token_1
const coin=mint.publicKey;
const [t0,t1] = Buffer.compare(coin.toBuffer(), WSOL.toBuffer())<0 ? [coin,WSOL] : [WSOL,coin];
const authority = pda([B("vault_and_lp_mint_auth_seed")], CPMM);
const poolState = pda([B("pool"), AMM_CONFIG.toBuffer(), t0.toBuffer(), t1.toBuffer()], CPMM);
const lpMint = pda([B("pool_lp_mint"), poolState.toBuffer()], CPMM);
const vault0 = pda([B("pool_vault"), poolState.toBuffer(), t0.toBuffer()], CPMM);
const vault1 = pda([B("pool_vault"), poolState.toBuffer(), t1.toBuffer()], CPMM);
const observation = pda([B("observation"), poolState.toBuffer()], CPMM);
const creatorCoin = getAssociatedTokenAddressSync(coin, admin.publicKey);
const creatorWsol = getAssociatedTokenAddressSync(WSOL, admin.publicKey);
const creatorLp = getAssociatedTokenAddressSync(lpMint, admin.publicKey);
console.log("pool:", poolState.toBase58());

try {
  const sig = await prog.methods.migrateToRaydium(new BN(0))
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
    .accounts({
    creator: admin.publicKey, bondingCurve: curve, mint: coin, curveVault,
    creatorCoin, wsolMint: WSOL, creatorWsol,
    cpSwapProgram: CPMM, ammConfig: AMM_CONFIG, authority, poolState,
    token0Mint: t0, token1Mint: t1, lpMint, creatorLpToken: creatorLp,
    token0Vault: vault0, token1Vault: vault1, createPoolFee: FEE_RCVR, observationState: observation,
    token0Program: TOKEN_PROGRAM_ID, token1Program: TOKEN_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
  }).rpc();
  console.log("migrate tx:", sig);
  const after = await prog.account.bondingCurve.fetch(curve);
  const poolAcc = await conn.getAccountInfo(poolState);
  const v0 = await conn.getTokenAccountBalance(vault0).catch(()=>null);
  const v1 = await conn.getTokenAccountBalance(vault1).catch(()=>null);
  console.log("graduated:", after.graduated, "pool exists:", !!poolAcc, "pool owner:", poolAcc?.owner.toBase58());
  console.log("vault0:", v0?.value.uiAmount, "vault1:", v1?.value.uiAmount);
  const lpSupply = await conn.getTokenSupply(lpMint).catch(()=>null);
  console.log("LP supply after burn:", lpSupply?.value.uiAmount, "(0 or tiny = LP burned = locked)");
  console.log("\nMIGRATE_TO_RAYDIUM: POOL CREATED ✓");
} catch(e){
  console.log("\nMIGRATE FAILED:", String(e.message||e).split("\n")[0]);
  if(e.logs) console.log(e.logs.slice(-18).join("\n"));
  process.exit(2);
}
