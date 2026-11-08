// v3 migrate test — system-owned SOL vault, CAPITAL-FREE crank.
// Full lifecycle on the new layout (create seeds [b"sol",mint], buys fund it, sell pays out of it),
// then migrate_to_raydium run by a FRESH crank funded with ~1 SOL (<< the ~85 SOL v2 needed) to prove
// the pooled SOL comes from the vault, not the crank's wallet.
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
console.log("program:", PID.toBase58());

const global = pda([B("global")]);
if(!(await prog.account.global.fetchNullable(global)))
  await prog.methods.initialize(new BN("2000000000"), new BN("1073000000000000"), new BN("1000000000000"), new BN("1000000000000000"), 125, 0)
    .accounts({admin:admin.publicKey, global, systemProgram:SystemProgram.programId}).rpc();

const mint = Keypair.generate();
const curve = pda([B("curve"), mint.publicKey.toBuffer()]);
const solVault = pda([B("sol"), mint.publicKey.toBuffer()]);
const curveVault = getAssociatedTokenAddressSync(mint.publicKey, curve, true);
const adminAta = getAssociatedTokenAddressSync(mint.publicKey, admin.publicKey);
await prog.methods.create("RayMig3","RMG3",250,new BN("500000000")).accounts({
  payer:admin.publicKey, creator:admin.publicKey, global, mint:mint.publicKey, bondingCurve:curve, solVault, curveVault,
  devAta:adminAta, tokenProgram:TOKEN_PROGRAM_ID, associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,
  systemProgram:SystemProgram.programId, rent:SYSVAR_RENT_PUBKEY }).signers([mint]).rpc();
console.log("created. sol_vault:", solVault.toBase58(), "lamports:", (await conn.getBalance(solVault))/1e9);

const acc={user:admin.publicKey,global,mint:mint.publicKey,bondingCurve:curve,solVault,curveVault,userAta:adminAta,tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId};
for(let i=0;i<20;i++){ try{ await prog.methods.buy(new BN(String(2*LAMPORTS_PER_SOL)),new BN(0)).accounts(acc).rpc(); }catch{ break; } const cc=await prog.account.bondingCurve.fetch(curve); if(cc.complete)break; }

// prove a sell pays OUT of the vault before completion? coin likely complete now; check the vault holds the SOL.
let c=await prog.account.bondingCurve.fetch(curve);
const vaultBal = await conn.getBalance(solVault);
const curveAcctBal = await conn.getBalance(curve);
console.log("complete:", c.complete, "realSol:", Number(c.realSol)/1e9, "floorVault:", Number(c.floorVault)/1e9);
console.log("sol_vault lamports:", vaultBal/1e9, "(should ≈ realSol+floorVault+rentSeed)");
console.log("bonding_curve lamports:", curveAcctBal/1e9, "(should be only its own data rent — NO user SOL)");
if(!c.complete){ console.log("FAIL: coin did not complete"); process.exit(1); }

// derive Raydium accounts
const coin=mint.publicKey;
const [t0,t1] = Buffer.compare(coin.toBuffer(), WSOL.toBuffer())<0 ? [coin,WSOL] : [WSOL,coin];
const authority = pda([B("vault_and_lp_mint_auth_seed")], CPMM);
const poolState = pda([B("pool"), AMM_CONFIG.toBuffer(), t0.toBuffer(), t1.toBuffer()], CPMM);
const lpMint = pda([B("pool_lp_mint"), poolState.toBuffer()], CPMM);
const vault0 = pda([B("pool_vault"), poolState.toBuffer(), t0.toBuffer()], CPMM);
const vault1 = pda([B("pool_vault"), poolState.toBuffer(), t1.toBuffer()], CPMM);
const observation = pda([B("observation"), poolState.toBuffer()], CPMM);

// FRESH CRANK, funded with only ~0.03 SOL (v3.1: the pool pre-funds the sender, so the crank needs
// nothing of its own beyond the base tx fee — this proves creator-needs-ZERO).
const crank = Keypair.generate();
await conn.confirmTransaction(await conn.requestAirdrop(crank.publicKey, 0.03*LAMPORTS_PER_SOL), "confirmed");
const crankStart = await conn.getBalance(crank.publicKey);
const poolSolTarget = Number(c.realSol)+Number(c.floorVault);
console.log(`\ncrank funded: ${crankStart/1e9} SOL. pooled SOL to deposit: ${poolSolTarget/1e9} SOL`);
console.log(`=> crank holds FAR LESS than the pool deposit (${(crankStart/1e9).toFixed(2)} << ${(poolSolTarget/1e9).toFixed(2)}): capital-free if migrate lands.`);
const crankProvider = new AnchorProvider(conn, new Wallet(crank), {commitment:"confirmed"});
const progC = new Program(idl, crankProvider);
const creatorCoin = getAssociatedTokenAddressSync(coin, crank.publicKey);
const creatorWsol = getAssociatedTokenAddressSync(WSOL, crank.publicKey);
const creatorLp = getAssociatedTokenAddressSync(lpMint, crank.publicKey);

try {
  const sig = await progC.methods.migrateToRaydium(new BN(0))
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 })])
    .accounts({
    creator: crank.publicKey, bondingCurve: curve, mint: coin, solVault, curveVault,
    creatorCoin, wsolMint: WSOL, creatorWsol,
    cpSwapProgram: CPMM, ammConfig: AMM_CONFIG, authority, poolState,
    token0Mint: t0, token1Mint: t1, lpMint, creatorLpToken: creatorLp,
    token0Vault: vault0, token1Vault: vault1, createPoolFee: FEE_RCVR, observationState: observation,
    token0Program: TOKEN_PROGRAM_ID, token1Program: TOKEN_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
  }).signers([crank]).rpc();
  console.log("migrate tx:", sig);
  const after = await prog.account.bondingCurve.fetch(curve);
  const poolAcc = await conn.getAccountInfo(poolState);
  const v0 = await conn.getTokenAccountBalance(vault0).catch(()=>null);
  const v1 = await conn.getTokenAccountBalance(vault1).catch(()=>null);
  const lpSupply = await conn.getTokenSupply(lpMint).catch(()=>null);
  const crankEnd = await conn.getBalance(crank.publicKey);
  const vaultEnd = await conn.getBalance(solVault);
  console.log("graduated:", after.graduated, "pool exists:", !!poolAcc, "pool owner:", poolAcc?.owner.toBase58());
  console.log("pool vault0:", v0?.value.uiAmount, "pool vault1:", v1?.value.uiAmount);
  console.log("LP supply after burn:", lpSupply?.value.uiAmount, "(0 = LP burned = liquidity locked)");
  console.log(`crank balance: ${crankStart/1e9} -> ${crankEnd/1e9} SOL (net ${((crankEnd-crankStart)/1e9).toFixed(4)}; it never fronted the pool)`);
  console.log(`sol_vault drained: ${vaultBal/1e9} -> ${vaultEnd/1e9} SOL (rent-min seed stays)`);
  console.log("\nMIGRATE_TO_RAYDIUM v3 (capital-free): POOL CREATED ✓");
} catch(e){
  console.log("\nMIGRATE FAILED:", String(e.message||e).split("\n")[0]);
  if(e.logs) console.log(e.logs.slice(-20).join("\n"));
  process.exit(2);
}
