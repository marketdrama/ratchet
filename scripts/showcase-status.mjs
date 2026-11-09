// Read-only shutdown inspection. This script never closes a program or submits a transaction.
import {Connection,PublicKey} from '@solana/web3.js';
import {unpackMint,unpackAccount,getAssociatedTokenAddressSync} from '@solana/spl-token';
import anchor from '@coral-xyz/anchor';
import {readFileSync,writeFileSync} from 'node:fs';
const idl=JSON.parse(readFileSync('lib/idl.json')),pid=new PublicKey(idl.address),conn=new Connection(process.env.RPC_URL??'https://api.mainnet-beta.solana.com','confirmed');
const MAINNET='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
if(await conn.getGenesisHash()!==MAINNET)throw new Error('Mainnet genesis required');
const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const program=await conn.getAccountInfo(pid),report={checkedAt:new Date().toISOString(),readOnly:true,program:pid.toBase58(),programExists:!!program,closureAllowed:false,blockers:[],coins:[]};
if(program){
 if(!program.owner.equals(loader)||program.data.readUInt32LE(0)!==2)throw new Error('Unexpected program loader/layout');
 const address=new PublicKey(program.data.subarray(4,36)),data=await conn.getAccountInfo(address);
 if(!data?.owner.equals(loader)||data.data.readUInt32LE(0)!==3)throw new Error('Unexpected ProgramData layout');
 report.programData=address.toBase58();report.programDataRentLamports=String(data.lamports);
 report.upgradeAuthority=data.data[12]===1?new PublicKey(data.data.subarray(13,45)).toBase58():null;
 if(!report.upgradeAuthority)report.blockers.push('Upgrade authority is revoked; ProgramData cannot be reclaimed');
 const coder=new anchor.BorshAccountsCoder(idl),filter=coder.memcmp('BondingCurve');
 const accounts=await conn.getProgramAccounts(pid,{filters:[{memcmp:filter}]});
 for(const {pubkey,account} of accounts){
  const c=coder.decode('BondingCurve',account.data),mint=new PublicKey(c.mint),vault=getAssociatedTokenAddressSync(mint,pubkey,true),[sol]=PublicKey.findProgramAddressSync([Buffer.from('sol'),mint.toBuffer()],pid);
  const [mintInfo,tokenInfo,solInfo]=await conn.getMultipleAccountsInfo([mint,vault,sol]);if(!mintInfo||!tokenInfo)throw new Error('Coin account missing');
  const supply=unpackMint(mint,mintInfo).supply,curveTokens=unpackAccount(vault,tokenInfo).amount,outside=supply-curveTokens;
  report.coins.push({mint:mint.toBase58(),graduated:c.graduated,supply:String(supply),tokensOutsideCurve:String(outside),floorVaultLamports:c.floorVault.toString(),realSolLamports:c.realSol.toString(),solVaultLamports:String(solInfo?.lamports??0)});
  if(outside>0n||BigInt(c.floorVault.toString())>0n||BigInt(c.realSol.toString())>0n)report.blockers.push('Unsettled positions/reserves for '+mint.toBase58());
 }
 if(report.coins.length)report.blockers.push('v4 has no coin/global account cleanup instructions; closure does not refund these balances. Review every coin and pool before closing');
 report.blockers.push('Manual owner review and upgrade-authority signature are required for any future closure');
}else report.blockers.push('Program is not deployed; no ProgramData deposit exists to reclaim');
writeFileSync('release/showcase-status.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
