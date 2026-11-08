// migrate-raydium.mjs — step 2 of the Raydium CPMM migration (run AFTER release_for_migration).
//
// Flow: a coin's curve completes -> admin calls `release_for_migration` on the program (step 1),
// which sends the remaining tokens + the curve reserves + the floor vault to the admin wallet.
// This script then creates a REAL Raydium CPMM pool (token / wSOL) from those funds and BURNS the
// LP tokens, so the liquidity is permanently locked and the coin trades on Raydium + Jupiter.
//
// Status: ready-to-run, but NOT yet end-to-end tested on devnet — it needs a completed coin and
// ~0.3+ SOL (Raydium's create-pool fee ~0.15 SOL + rent + the pooled SOL). Run it on devnet once a
// coin has graduated and been released. The SDK handles wSOL wrapping, the 20-account init, and fees.
//
//   npm i @raydium-io/raydium-sdk-v2 @solana/web3.js @solana/spl-token bn.js
//   RPC_URL=https://api.devnet.solana.com MINT=<mint> node migrate-raydium.mjs
//
// Devnet Raydium constants (verify on-chain before mainnet; mainnet ids differ):
//   CPMM program     DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb
//   AmmConfig idx 0  D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2
//   createPool fee   3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, getAccount, createBurnInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { readFileSync } from "node:fs";
import BN from "bn.js";
import { Raydium, TxVersion, DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId } from "@raydium-io/raydium-sdk-v2";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const MINT = new PublicKey(process.env.MINT ?? (() => { throw new Error("set MINT=<coin mint>"); })());
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const CREATE_POOL_FEE = new PublicKey("3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy"); // devnet

const owner = Keypair.fromSecretKey(new Uint8Array(JSON.parse(
  readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8")))); // = program ADMIN
const connection = new Connection(RPC_URL, "confirmed");

async function main() {
  const raydium = await Raydium.load({ connection, owner, cluster: "devnet", disableLoadToken: false });

  // the released funds the admin now holds: all the coin tokens + the SOL (reserves + floor vault)
  const tokenAta = getAssociatedTokenAddressSync(MINT, owner.publicKey);
  const tokenBal = new BN((await getAccount(connection, tokenAta)).amount.toString());
  const solBal = new BN((await connection.getBalance(owner.publicKey)).toString());
  // keep a cushion for the create-pool fee (~0.15) + rent + tx fees; pool the rest as SOL
  const solForPool = solBal.sub(new BN(0.35 * 1e9));
  if (solForPool.lten(0)) throw new Error("not enough SOL released to seed the pool + pay the create fee");

  // Raydium orders mintA/mintB; pass our token + wSOL and the amounts, SDK wraps SOL.
  const feeConfigs = await raydium.api.getCpmmConfigs();
  const feeConfig = feeConfigs[0]; // index-0 standard config (matches AmmConfig idx 0)

  const { execute, extInfo } = await raydium.cpmm.createPool({
    programId: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM, // DRaycpLY…
    poolFeeAccount: CREATE_POOL_FEE,
    mintA: await raydium.token.getTokenInfo(MINT.toBase58()),
    mintB: await raydium.token.getTokenInfo(WSOL.toBase58()),
    mintAAmount: tokenBal,
    mintBAmount: solForPool,
    startTime: new BN(0),
    feeConfig,
    associatedOnly: false,
    ownerInfo: { useSOLBalance: true },
    txVersion: TxVersion.V0,
  });
  const { txId } = await execute({ sendAndConfirm: true });
  const lpMint = new PublicKey(extInfo.address.lpMint);
  console.log("pool created:", txId);
  console.log("poolId:", extInfo.address.poolId.toString(), "lpMint:", lpMint.toBase58());

  // BURN the LP -> permanent locked liquidity (Raydium has no native lock; burning is permanent).
  const lpAta = getAssociatedTokenAddressSync(lpMint, owner.publicKey);
  const lpBal = (await getAccount(connection, lpAta)).amount;
  const { Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
  const burnTx = new Transaction().add(
    createBurnInstruction(lpAta, lpMint, owner.publicKey, lpBal, [], TOKEN_PROGRAM_ID));
  const burnSig = await sendAndConfirmTransaction(connection, burnTx, [owner]);
  console.log("LP burned (liquidity locked):", burnSig, "amount:", lpBal.toString());
  console.log("DONE — coin now trades on Raydium; LP permanently locked.");
}
main().catch((e) => { console.error("migration failed:", e.message ?? e); process.exit(1); });
