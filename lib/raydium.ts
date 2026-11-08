import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
export const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
export const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export function migrationAccounts(pid: PublicKey, mint: PublicKey, creator: PublicKey, devnet = false) {
  const cpSwapProgram = new PublicKey(devnet ? "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb" : "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
  const derive = (seeds: Uint8Array[], program = cpSwapProgram) => PublicKey.findProgramAddressSync(seeds, program)[0];
  const b = (s: string) => Buffer.from(s);
  const [token0Mint, token1Mint] = Buffer.compare(mint.toBuffer(), WSOL.toBuffer()) < 0 ? [mint,WSOL] : [WSOL,mint];
  const ammConfig = derive([b("amm_config"), Buffer.from([0,0])]);
  const poolState = derive([b("pool"),ammConfig.toBuffer(),token0Mint.toBuffer(),token1Mint.toBuffer()]);
  const lpMint = derive([b("pool_lp_mint"),poolState.toBuffer()]);
  const bondingCurve = derive([b("curve"),mint.toBuffer()],pid);
  return {creator,bondingCurve,mint,solVault:derive([b("sol"),mint.toBuffer()],pid),
    curveVault:getAssociatedTokenAddressSync(mint,bondingCurve,true),creatorCoin:getAssociatedTokenAddressSync(mint,creator),
    wsolMint:WSOL,creatorWsol:getAssociatedTokenAddressSync(WSOL,creator),cpSwapProgram,ammConfig,
    authority:derive([b("vault_and_lp_mint_auth_seed")]),poolState,token0Mint,token1Mint,lpMint,
    creatorLpToken:getAssociatedTokenAddressSync(lpMint,creator),
    token0Vault:derive([b("pool_vault"),poolState.toBuffer(),token0Mint.toBuffer()]),
    token1Vault:derive([b("pool_vault"),poolState.toBuffer(),token1Mint.toBuffer()]),
    createPoolFee:new PublicKey(devnet?"3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy":"DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8"),
    observationState:derive([b("observation"),poolState.toBuffer()]),token0Program:TOKEN_PROGRAM_ID,token1Program:TOKEN_PROGRAM_ID,
    tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId,rent:SYSVAR_RENT_PUBKEY};
}
export function metadataPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("metadata"),METADATA_PROGRAM.toBuffer(),mint.toBuffer()],METADATA_PROGRAM)[0];
}
export function swapUrl(mint: string) {
  return `https://raydium.io/swap/?inputMint=${WSOL.toBase58()}&outputMint=${encodeURIComponent(mint)}`;
}
