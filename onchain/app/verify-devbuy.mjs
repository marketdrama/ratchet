// Focused on-chain verification of the dev-buy floor seed:
// create with dev_buy > 0 opens the coin with a non-zero floor (25% of the dev buy
// seeded into the vault, the rest bought on the curve for the dev); dev_buy == 0 opens floorless.
import anchor from "@coral-xyz/anchor";
import {
  Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { BN, AnchorProvider, Program, Wallet } = anchor;
const here = dirname(fileURLToPath(import.meta.url));
const idl = JSON.parse(readFileSync(join(here, "../target/idl/ratchet_curve.json"), "utf8"));
const deployer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(
  readFileSync(join(process.env.HOME, ".config/solana/id.json"), "utf8"))));

const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const payer = Keypair.generate();
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
anchor.setProvider(provider);
const program = new Program(idl, provider);
const PID = program.programId;
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PID)[0];
const B = (s) => Buffer.from(s);
const sol = (n) => new BN(Math.round(n * LAMPORTS_PER_SOL));
const asSol = (x) => Number(x.toString()) / LAMPORTS_PER_SOL;

async function fund(kp, n) {
  await connection.confirmTransaction(await connection.requestAirdrop(kp.publicKey, n * LAMPORTS_PER_SOL), "confirmed");
}

async function createCoin(name, symbol, sellFeeBps, devBuySol) {
  const mint = Keypair.generate();
  const curve = pda([B("curve"), mint.publicKey.toBuffer()]);
  const solVault = pda([B("sol"), mint.publicKey.toBuffer()]); // v3 system-owned SOL vault PDA
  const curveVault = getAssociatedTokenAddressSync(mint.publicKey, curve, true);
  const devAta = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey);
  await program.methods.create(name, symbol, sellFeeBps, sol(devBuySol)).accounts({
    payer: payer.publicKey, creator: payer.publicKey, global: pda([B("global")]), mint: mint.publicKey,
    bondingCurve: curve, solVault, curveVault, devAta, tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
  }).signers([mint]).rpc();
  const c = await program.account.bondingCurve.fetch(curve);
  let devTokens = 0;
  try { devTokens = Number((await connection.getTokenAccountBalance(devAta)).value.amount) / 1e6; } catch {}
  return { mint: mint.publicKey, c, devTokens };
}

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

async function main() {
  await fund(payer, 20);
  // init global if needed (deployer = ADMIN)
  const global = pda([B("global")]);
  if (!(await program.account.global.fetchNullable(global))) {
    await fund(deployer, 5);
    const dp = new AnchorProvider(connection, new Wallet(deployer), { commitment: "confirmed" });
    const dprog = new Program(idl, dp);
    await dprog.methods.initialize(new BN("30000000000"), new BN("1073000000000000"),
      new BN("793100000000000"), new BN("1000000000000000"), 125, 0)
      .accounts({ admin: deployer.publicKey, global, systemProgram: SystemProgram.programId }).rpc();
    console.log("global initialized");
  }

  // 1) dev buy = 4 SOL -> 25% (=1 SOL) seeds the floor
  const a = await createCoin("Seeded", "SEED", 125, 4);
  const vault = asSol(a.c.floorVault);
  ok(Math.abs(vault - 1.0) < 1e-6, `dev buy 4 SOL -> vault = ${vault} SOL (expect 1.0 = 25%)`);
  ok(a.c.floorScaled.toString() !== "0", `floor opens non-zero (floorScaled=${a.c.floorScaled.toString()})`);
  ok(a.devTokens > 0, `dev received tokens on launch (${a.devTokens.toLocaleString()} SEED)`);
  ok(a.c.circulating.toString() !== "0", `circulating > 0 at launch`);

  // 2) dev buy = 0 -> floorless open (old behavior)
  const b = await createCoin("Bare", "BARE", 250, 0);
  ok(asSol(b.c.floorVault) === 0, `dev buy 0 -> vault = 0`);
  ok(b.c.floorScaled.toString() === "0", `dev buy 0 -> floor stays 0`);
  ok(b.devTokens === 0, `dev buy 0 -> no launch tokens`);

  // 3) bigger dev buy seeds a bigger floor (floor price scales with the seed)
  const d = await createCoin("Big", "BIG", 500, 10);
  const vaultBig = asSol(d.c.floorVault);
  ok(Math.abs(vaultBig - 2.5) < 1e-6, `dev buy 10 SOL -> vault = ${vaultBig} SOL (expect 2.5 = 25%)`);

  console.log(fails === 0 ? "\nALL DEV-BUY CHECKS PASS" : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
