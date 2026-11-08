import anchor from '@coral-xyz/anchor';
import {Connection,Keypair,PublicKey,SystemProgram,SYSVAR_RENT_PUBKEY,ComputeBudgetProgram,VersionedTransaction} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {migrationAccounts,metadataPda,METADATA_PROGRAM} from '../../lib/raydium.ts';
export {migrationAccounts};
export const {BN}=anchor;
export function client(rpc,wallet,idlPath=new URL('../target/idl/ratchet_curve.json',import.meta.url)) {
  const idl=JSON.parse(readFileSync(idlPath));
  const conn=new Connection(rpc,'confirmed');
  const prog=new anchor.Program(idl,new anchor.AnchorProvider(conn,new anchor.Wallet(wallet),{commitment:'confirmed'}));
  const pid=prog.programId;
  const pda=(name,mint)=>PublicKey.findProgramAddressSync([Buffer.from(name),...(mint?[mint.toBuffer()]:[])],pid)[0];
  const global=pda('global');
  const trade=(mint,user=wallet.publicKey)=>({user,global,mint,bondingCurve:pda('curve',mint),solVault:pda('sol',mint),
    curveVault:getAssociatedTokenAddressSync(mint,pda('curve',mint),true),userAta:getAssociatedTokenAddressSync(mint,user),
    tokenProgram:TOKEN_PROGRAM_ID,associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId});
  const initialize=async(params)=>prog.methods.initialize(new BN(String(params.virtualSol)),new BN(String(params.virtualToken)),
    new BN(String(params.realToken)),new BN(String(params.totalSupply)),params.feeBps,params.floorCutBps)
    .accounts({admin:wallet.publicKey,global,systemProgram:SystemProgram.programId}).rpc();
  const createBuilder=(mint,name,symbol,uri,devBuy=0n)=>prog.methods.create(name,symbol,uri,250,new BN(String(devBuy)))
    .accounts({payer:wallet.publicKey,creator:wallet.publicKey,global,mint:mint.publicKey,bondingCurve:pda('curve',mint.publicKey),
      solVault:pda('sol',mint.publicKey),curveVault:getAssociatedTokenAddressSync(mint.publicKey,pda('curve',mint.publicKey),true),
      devAta:getAssociatedTokenAddressSync(mint.publicKey,wallet.publicKey),tokenProgram:TOKEN_PROGRAM_ID,
      associatedTokenProgram:ASSOCIATED_TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId,rent:SYSVAR_RENT_PUBKEY,
      metadata:metadataPda(mint.publicKey),metadataProgram:METADATA_PROGRAM})
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({units:400_000})]).signers([mint]);
  const create=async(mint,name,symbol,uri,devBuy=0n,maxSpend)=>{
    const builder=createBuilder(mint,name,symbol,uri,devBuy);
    if(maxSpend===undefined)return builder.rpc();
    const block=await conn.getLatestBlockhash('confirmed');
    const legacy=await builder.transaction();legacy.feePayer=wallet.publicKey;legacy.recentBlockhash=block.blockhash;
    const tx=new VersionedTransaction(legacy.compileMessage());tx.sign([wallet,mint]);
    const before=await conn.getBalance(wallet.publicKey);
    const sim=await conn.simulateTransaction(tx,{sigVerify:true,commitment:'confirmed',accounts:{encoding:'base64',addresses:[wallet.publicKey.toBase58()]}});
    if(sim.value.err)throw new Error('Create simulation failed: '+JSON.stringify(sim.value.err)+' '+(sim.value.logs??[]).slice(-5).join(' '));
    const after=sim.value.accounts?.[0]?.lamports;
    if(after===undefined||BigInt(before-after)>maxSpend)throw new Error('Simulated create spend exceeds MAX_SPEND_SOL');
    console.log('simulated create cost SOL:',(before-after)/1e9);
    const sig=await conn.sendTransaction(tx,{skipPreflight:false});
    const result=await conn.confirmTransaction({...block,signature:sig},'confirmed');if(result.value.err)throw new Error('Create transaction failed');return sig;
  };
  const migrate=async(mint,devnet=false,overrides={})=>prog.methods.migrateToRaydium(new BN(0))
    .accounts({...migrationAccounts(pid,mint,wallet.publicKey,devnet),...overrides})
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({units:600_000})]).rpc();
  const fetch=(mint)=>prog.account.bondingCurve.fetch(pda('curve',mint));
  return {conn,prog,pid,pda,global,trade,initialize,create,migrate,fetch};
}
export function quoteState(c){return Object.fromEntries(['virtualSol','virtualToken','realSol','realToken','floorVault','floorScaled']
  .map(k=>[k,BigInt(c[k].toString())]).concat([['sellFeeBps',c.sellFeeBps],['graduated',c.graduated]]));}
export function loadWallet(path){return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path))));}
