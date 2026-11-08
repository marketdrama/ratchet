// Read-only release funding/deployment snapshot. Never loads a private key or sends a transaction.
import {Connection,PublicKey} from '@solana/web3.js';
import {statSync,writeFileSync} from 'node:fs';
import {TOKEN_PROGRAM_ID,unpackAccount} from '@solana/spl-token';
import {MAINNET_GENESIS,migrationAccounts} from '../lib/raydium.ts';
const conn=new Connection(process.env.RPC_URL??'https://api.mainnet-beta.solana.com','confirmed');
if(await conn.getGenesisHash()!==MAINNET_GENESIS)throw new Error('Not mainnet');
const program=new PublicKey('35UELzdncBr15qztq55Kct3sZvmXnn5D5e5rpGiHgMuC');
const admin=new PublicKey('3vkTXSV3LG7ZrZt1SWMnEYBjNBiYAg168fbEV3Q6skTi');
const recordedDeployer=new PublicKey('2XPJm6qcPurJJ31jHrJZTKYoBQS9HkAtt1NyMnizXDWq');
const bytes=statSync('onchain/target/deploy/ratchet_curve.so').size,allocation=Math.ceil(bytes/4096)*4096;
const a=migrationAccounts(program,PublicKey.unique(),admin);
const accounts=await conn.getMultipleAccountsInfo([program,admin,recordedDeployer,a.cpSwapProgram,a.ammConfig,a.createPoolFee]);
if(!accounts[3]?.executable||!accounts[4]?.owner.equals(a.cpSwapProgram)||accounts[4].data.length<236)throw new Error('Unexpected Raydium deployment/config');
if(!accounts[5]?.owner.equals(TOKEN_PROGRAM_ID)||!unpackAccount(a.createPoolFee,accounts[5]).mint.equals(a.wsolMint))throw new Error('Unexpected pool fee receiver');
const config=accounts[4].data;
// AmmConfig layout: discriminator8, bump1, disable_create1, index2, four u64 fields;
// create_pool_fee is the fourth (offset 36); verified against Raydium states/config.rs.
const poolFee=config.readBigUInt64LE(36);
const [programRent,dataRent,bufferRent]=await Promise.all([conn.getMinimumBalanceForRentExemption(36),conn.getMinimumBalanceForRentExemption(45+allocation),conn.getMinimumBalanceForRentExemption(37+bytes)]);
// Loader-v3 deploy refunds the buffer to the payer BEFORE creating ProgramData.
// The CLI funds the buffer with dataRent; do not add it again to peak funding.
const sizes={global:101,mint:82,bondingCurve:483,curveTokenAccount:165,creatorTokenAccount:165,solVault:0,metadata:607};
const rents=Object.fromEntries(await Promise.all(Object.entries(sizes).map(async([key,size])=>[key,await conn.getMinimumBalanceForRentExemption(size)])));
const coinRent=Object.entries(rents).filter(([key])=>key!=='global').reduce((sum,[,rent])=>sum+rent,0);
const metadataCreateFee=10_000_000; // current Metaplex published protocol fee; separate from rent.
const baseRent=programRent+dataRent+rents.global;
const scenarios=[0,1,5,10].map(tokens=>({tokens,accountRentSOL:(baseRent+tokens*coinRent)/1e9,
  metadataFeesSOL:tokens*metadataCreateFee/1e9,totalExcludingNetworkFeesAndDevBuysSOL:(baseRent+tokens*(coinRent+metadataCreateFee))/1e9}));
const result={checkedAtUTC:new Date().toISOString(),readOnly:true,program:program.toBase58(),programExists:!!accounts[0],
  admin:admin.toBase58(),adminSOL:(accounts[1]?.lamports??0)/1e9,recordedDeployer:recordedDeployer.toBase58(),deployerSOL:(accounts[2]?.lamports??0)/1e9,
  binaryBytes:bytes,reviewedAllocationBytes:allocation,programRentSOL:programRent/1e9,programDataRentSOL:dataRent/1e9,
  bufferMinimumRentSOL:bufferRent/1e9,bufferFundedSOL:dataRent/1e9,
  peakDeployRentSOL:(programRent+dataRent)/1e9,bufferReusedForProgramData:true,
  globalRentSOL:rents.global/1e9,perCoinRentLamports:rents,perCoinRentSOL:coinRent/1e9,
  metadataCreateFeeSOL:metadataCreateFee/1e9,perCoinIncludingMetadataFeeSOL:(coinRent+metadataCreateFee)/1e9,
  earlyLaunchScenarios:scenarios,
  raydiumConfig:a.ammConfig.toBase58(),raydiumCreatePoolFeeLamports:poolFee.toString(),raydiumPoolCreationDisabled:config[9]!==0};
writeFileSync('release/mainnet-preflight.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
