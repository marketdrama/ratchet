// v3 smoke: buy funds the vault, sell pays OUT of the vault (vault_pay / invoke_signed), floor ratchets.
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { readFileSync } from "node:fs";
const { BN, AnchorProvider, Program, Wallet } = anchor;
const idl = JSON.parse(readFileSync("../target/idl/ratchet_curve.json","utf8"));
const admin = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(process.env.HOME+"/.config/solana/id.json","utf8"))));
const conn = new Connection("http://127.0.0.1:8899","confirmed");
const prog = new Program(idl, new AnchorProvider(conn, new Wallet(admin), {commitment:"confirmed"}));
const PID = new PublicKey(idl.address);
const pda=(s)=>PublicKey.findProgramAddressSync(s,PID)[0];
const B=(s)=>Buffer.from(s);
const global = pda([B("global")]);

const mint = Keypair.generate();
const curve = pda([B("curve"), mint.publicKey.toBuffer()]);
const solVault = pda([B("sol"), mint.publicKey.toBuffer()]);
const curveVault = getAssociatedTokenAddressSync(mint.publicKey, curve, true);
const ata = getAssociatedTokenAddressSync(mint.publicKey, admin.publicKey);
// no dev buy -> coin opens with floor 0, so a sell exercises the normal curve path
await prog.methods.create("SellV3","SLV3",300,new BN(0)).accounts({
  payer:admin.publicKey, creator:admin.publicKey, global, mint:mint.publicKey, bondingCurve:curve, solVault, curveVault,
  devAta:ata, tokenProgram:TOKEN_PROGRAM_ID, associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,
  systemProgram:SystemProgram.programId, rent:SYSVAR_RENT_PUBKEY }).signers([mint]).rpc();
const acc={user:admin.publicKey,global,mint:mint.publicKey,bondingCurve:curve,solVault,curveVault,userAta:ata,tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId};

await prog.methods.buy(new BN(String(1*LAMPORTS_PER_SOL)), new BN(0)).accounts(acc).rpc();
let c = await prog.account.bondingCurve.fetch(curve);
const vaultAfterBuy = await conn.getBalance(solVault);
const myTok = Number((await conn.getTokenAccountBalance(ata)).value.amount);
console.log("after 1 SOL buy -> sol_vault:", vaultAfterBuy/1e9, "SOL | floorVault:", Number(c.floorVault)/1e9, "| myTokens:", myTok/1e6);

const before = await conn.getBalance(admin.publicKey);
const vb = await conn.getBalance(solVault);
await prog.methods.sell(new BN(String(Math.floor(myTok/2))), new BN(0)).accounts(acc).rpc();
const after = await conn.getBalance(admin.publicKey);
const va = await conn.getBalance(solVault);
c = await prog.account.bondingCurve.fetch(curve);
console.log("sold half:", "user +", ((after-before)/1e9).toFixed(5), "SOL (fee paid) | sol_vault", (vb/1e9).toFixed(5), "->", (va/1e9).toFixed(5));
console.log("floorVault now:", Number(c.floorVault)/1e9, "floor clicked up via sell tax:", Number(c.floorScaled)>0);
if(after>before && va<vb){ console.log("\nSELL v3 (pays out of system vault): OK ✓"); } else { console.log("\nSELL v3: FAIL"); process.exit(3); }
