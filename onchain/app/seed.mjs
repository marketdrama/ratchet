// Seed the local validator with coins so the web feed has content. Initializes the
// global config (1.25% tax, all to floor) and creates several coins with varied buy history.
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const { BN, AnchorProvider, Program, Wallet } = anchor;
const here = dirname(fileURLToPath(import.meta.url));
const idl = JSON.parse(readFileSync(join(here, "../target/idl/ratchet_curve.json"), "utf8"));
const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const payer = Keypair.generate();
// The program gates `initialize` to the hardcoded ADMIN (= the deployer in
// ~/.config/solana/id.json). Load it to sign the global init.
const deployer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(join(homedir(), ".config/solana/id.json"), "utf8"))));
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
const program = new Program(idl, provider);
const PID = program.programId;
const pda = (s) => PublicKey.findProgramAddressSync(s, PID)[0];
const B = (s) => Buffer.from(s);
const SOL = (n) => new BN(Math.round(n * LAMPORTS_PER_SOL));

// Buy totals (SOL) tuned for 30-SOL-virtual economics: graduation is ~86 SOL gross
// (1.25% tax, so ~98.75% of each buy reaches the curve), so these span fresh (~6 SOL)
// to graduated (>86 SOL) for a varied feed.
// [name, symbol, totalBuy SOL, sellFeeBps (125..=500 = 1.25%..5%)] — vary the per-coin sell tax
// [name, symbol, totalBuy (organic SOL after launch), sellFeeBps, devBuy (SOL; 25% seeds the floor)]
const COINS = [
  ["only up", "UP", 110, 125, 3], ["Ratchet Cat", "RCAT", 32, 500, 1], ["Click Clack", "CLACK", 60, 250, 2],
  ["Never Down", "NVRD", 125, 125, 4], ["Floor Gang", "FLOOR", 18, 500, 0.5], ["Higher Pill", "PILL", 82, 300, 2.5],
  ["Diamond Ratchet", "DRCH", 12, 250, 1], ["Bedrock", "ROCK", 50, 125, 2], ["The Ladder", "LADR", 100, 400, 3],
  ["Antigravity", "AGRAV", 6, 500, 0.5],
];

async function main() {
  // total buys ~595 SOL + rent/fees; localnet faucet caps a single airdrop, so loop.
  let funded = 0;
  while (funded < 800) {
    const sig = await connection.requestAirdrop(payer.publicKey, 100 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    funded += 100;
  }
  const global = pda([B("global")]);
  if (!(await program.account.global.fetchNullable(global))) {
    // admin (= deployer) pays global rent + must sign; fund it first.
    await connection.confirmTransaction(
      await connection.requestAirdrop(deployer.publicKey, 5 * LAMPORTS_PER_SOL), "confirmed");
    await program.methods.initialize(new BN("30000000000"), new BN("1073000000000000"),
      new BN("793100000000000"), new BN("1000000000000000"), 125, 0)
      .accounts({ admin: deployer.publicKey, global, systemProgram: SystemProgram.programId })
      .signers([deployer]).rpc();
    console.log("global initialized (30 SOL virtual, 1.25% tax -> floor) by admin", deployer.publicKey.toBase58());
  }

  for (const [name, symbol, totalBuy, sellFeeBps, devBuy] of COINS) {
    const mint = Keypair.generate();
    const curve = pda([B("curve"), mint.publicKey.toBuffer()]);
    const solVault = pda([B("sol"), mint.publicKey.toBuffer()]); // v3 system-owned SOL vault PDA
    const curveVault = getAssociatedTokenAddressSync(mint.publicKey, curve, true);
    const userAta = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey);
    const devBuyLamports = new BN(Math.round((devBuy ?? 0) * Number(LAMPORTS_PER_SOL)));
    await program.methods.create(name, symbol, sellFeeBps, devBuyLamports).accounts({
      payer: payer.publicKey, creator: payer.publicKey, global, mint: mint.publicKey,
      bondingCurve: curve, solVault, curveVault, devAta: userAta, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
    }).signers([mint]).rpc();
    const acc = { user: payer.publicKey, global, mint: mint.publicKey, bondingCurve: curve, solVault, curveVault, userAta,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId };
    // break totalBuy into a few buys
    let left = totalBuy;
    while (left > 0.05) {
      const amt = Math.min(left, 1 + Math.random() * 5); // bigger chunks: fewer txs
      left -= amt;
      try { await program.methods.buy(SOL(amt), new BN(0)).accounts(acc).rpc(); }
      catch { break; } // curve may complete
    }
    const c = await program.account.bondingCurve.fetch(curve);
    if (c.complete && !c.graduated) {
      await program.methods.graduate().accounts({ bondingCurve: curve, curveVault }).rpc();
    }
    console.log(`${symbol.padEnd(6)} ${mint.publicKey.toBase58()}  complete=${c.complete}`);
  }
  console.log("seed done");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
