import { Connection, PublicKey } from "@solana/web3.js";
const CPMM = new PublicKey("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb");
const dev = new Connection("https://api.devnet.solana.com","confirmed");
const u16be = (n)=>{const b=Buffer.alloc(2); b.writeUInt16BE(n); return b;};
const pda=(seeds)=>PublicKey.findProgramAddressSync(seeds, CPMM)[0];
const ammConfig0 = pda([Buffer.from("amm_config"), u16be(0)]);
const authority = pda([Buffer.from("vault_and_lp_mint_auth_seed")]);
console.log("derived amm_config[0]:", ammConfig0.toBase58());
console.log("derived authority   :", authority.toBase58());
for (const [name,pk] of [["amm_config[0]",ammConfig0],["authority",authority]]) {
  const a = await dev.getAccountInfo(pk);
  console.log(`${name}: ${a?`exists owner=${a.owner.toBase58()} len=${a.data.length}`:"MISSING on devnet"}`);
}
// also check the searched addr
const searched = new PublicKey("D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2");
const sa = await dev.getAccountInfo(searched);
console.log("searched D4FPE…:", sa?`exists owner=${sa.owner.toBase58()} len=${sa.data.length}`:"MISSING on devnet");
