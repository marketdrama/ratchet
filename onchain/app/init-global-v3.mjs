import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { readFileSync } from "node:fs";
const { BN, AnchorProvider, Program, Wallet } = anchor;
const idl = JSON.parse(readFileSync("../target/idl/ratchet_curve.json","utf8"));
const admin = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(process.env.HOME+"/.config/solana/id.json","utf8"))));
const conn = new Connection("http://127.0.0.1:8899","confirmed");
const prog = new Program(idl, new AnchorProvider(conn, new Wallet(admin), {commitment:"confirmed"}));
const global = PublicKey.findProgramAddressSync([Buffer.from("global")], new PublicKey(idl.address))[0];
if(!(await prog.account.global.fetchNullable(global))){
  await prog.methods.initialize(new BN("2000000000"),new BN("1073000000000000"),new BN("900000000000000"),new BN("1000000000000000"),100,2500)
    .accounts({admin:admin.publicKey, global, systemProgram:SystemProgram.programId}).rpc();
  console.log("global initialized by admin");
} else console.log("global exists");
