// Lean devnet seed: no airdrops (devnet faucet is rate-limited). The deployer keypair
// (~/.config/solana/id.json) is admin + payer + buyer. Inits global (1.25% tax) and
// creates a few small, non-graduated coins so the live app has real content to read.
// Graduated coins need ~86 SOL each — out of budget on devnet; mock data covers those.
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
const RPC = process.env.RPC || "https://api.devnet.solana.com";
const connection = new Connection(RPC, "confirmed");
const deployer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(join(homedir(), ".config/solana/id.json"), "utf8"))));
const provider = new AnchorProvider(connection, new Wallet(deployer), { commitment: "confirmed" });
const program = new Program(idl, provider);
const PID = program.programId;
const pda = (s) => PublicKey.findProgramAddressSync(s, PID)[0];
const B = (s) => Buffer.from(s);
const SOL = (n) => new BN(Math.round(n * LAMPORTS_PER_SOL));

// small buys — low-mcap curve coins (deployer pays). Keep total well under budget.
// [name, symbol, totalBuy SOL, sellFeeBps (125..=500)]
// [name, symbol, totalBuy, sellFeeBps, devBuy (SOL; 25% seeds the floor)]
const COINS = [
  ["only up", "UP", 0.6, 125, 0.2], ["Ratchet Cat", "RCAT", 0.2, 500, 0.1],
  ["Floor Gang", "FLOOR", 0.4, 300, 0.15], ["Bedrock", "ROCK", 0.1, 250, 0.1],
];

async function main() {
  const bal = await connection.getBalance(deployer.publicKey);
  console.log("deployer", deployer.publicKey.toBase58(), (bal / LAMPORTS_PER_SOL).toFixed(3), "SOL");

  const global = pda([B("global")]);
  if (!(await program.account.global.fetchNullable(global))) {
    await program.methods.initialize(new BN("30000000000"), new BN("1073000000000000"),
      new BN("793100000000000"), new BN("1000000000000000"), 125, 0)
      .accounts({ admin: deployer.publicKey, global, systemProgram: SystemProgram.programId })
      .signers([deployer]).rpc();
    console.log("global initialized (30 SOL virtual, 1.25% tax -> floor)");
  } else { console.log("global already exists"); }

  for (const [name, symbol, totalBuy, sellFeeBps, devBuy] of COINS) {
    const mint = Keypair.generate();
    const curve = pda([B("curve"), mint.publicKey.toBuffer()]);
    const solVault = pda([B("sol"), mint.publicKey.toBuffer()]); // v3 system-owned SOL vault PDA
    const curveVault = getAssociatedTokenAddressSync(mint.publicKey, curve, true);
    const userAta = getAssociatedTokenAddressSync(mint.publicKey, deployer.publicKey);
    const devBuyLamports = new BN(Math.round((devBuy ?? 0) * Number(LAMPORTS_PER_SOL)));
    await program.methods.create(name, symbol, sellFeeBps, devBuyLamports).accounts({
      payer: deployer.publicKey, creator: deployer.publicKey, global, mint: mint.publicKey,
      bondingCurve: curve, solVault, curveVault, devAta: userAta, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
    }).signers([mint]).rpc();
    const acc = { user: deployer.publicKey, global, mint: mint.publicKey, bondingCurve: curve, solVault, curveVault, userAta,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId };
    let left = totalBuy;
    while (left > 0.02) {
      const amt = Math.min(left, 0.25);
      left -= amt;
      try { await program.methods.buy(SOL(amt), new BN(0)).accounts(acc).rpc(); }
      catch (e) { console.log("  buy stop:", e.message?.slice(0, 50)); break; }
    }
    console.log(`${symbol.padEnd(6)} ${mint.publicKey.toBase58()}`);
  }
  const end = await connection.getBalance(deployer.publicKey);
  console.log("seed done; deployer left", (end / LAMPORTS_PER_SOL).toFixed(3), "SOL");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
