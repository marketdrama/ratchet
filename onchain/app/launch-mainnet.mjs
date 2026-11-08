// v4 explicit, resumable lifecycle tool. Default is read-only preflight.
// ACTION=initialize|create|complete|migrate|redeem; CLUSTER=mainnet-beta|devnet|localnet.
import {Keypair,PublicKey} from '@solana/web3.js';
import {getMint} from '@solana/spl-token';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {client,loadWallet,BN,quoteState,migrationAccounts} from './client.mjs';
import {PRODUCTION,TEST_PARAMS,quoteBuy,quoteSell,minOutput,migrationBudget,solAmount} from '../../lib/protocol.ts';
import {MAINNET_GENESIS,DEVNET_GENESIS} from '../../lib/raydium.ts';
const rpc=process.env.RPC_URL,cluster=process.env.CLUSTER??'mainnet-beta',action=process.env.ACTION??'preflight';
if(!rpc)throw new Error('RPC_URL is required');
if(!['mainnet-beta','devnet','localnet'].includes(cluster))throw new Error('Unknown CLUSTER');
if(!['preflight','initialize','create','complete','migrate','redeem'].includes(action))throw new Error('Unknown ACTION');
const mode=process.env.MODE??'prod';
if(!['prod','test'].includes(mode)||cluster==='mainnet-beta'&&mode!=='prod')throw new Error('Mainnet requires MODE=prod; test uses a separate deployment');
const params=mode==='prod'?PRODUCTION:TEST_PARAMS;
const wallet=loadWallet(process.env.WALLET??process.env.HOME+'/.config/solana/id.json');
const c=client(rpc,wallet);const genesis=await c.conn.getGenesisHash();
if(cluster==='mainnet-beta'&&genesis!==MAINNET_GENESIS||cluster==='devnet'&&genesis!==DEVNET_GENESIS||
  cluster==='localnet'&&(!['localhost','127.0.0.1','[::1]'].includes(new URL(rpc).hostname)||[MAINNET_GENESIS,DEVNET_GENESIS].includes(genesis)))throw new Error('RPC genesis/cluster mismatch');
const program=await c.conn.getAccountInfo(c.pid);if(!program?.executable)throw new Error('Expected executable program is not deployed on this cluster');
// Require the release manifest's mainnet constants and current artifact identity before writes.
if(cluster==='mainnet-beta'){
  const {verifyRelease}=await import('../../scripts/verify-release.mjs');await verifyRelease();
  if(!program.owner.equals(new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111')))throw new Error('Mainnet program must use upgradeable loader-v3');
  const data=await c.conn.getAccountInfo(new PublicKey(program.data.subarray(4,36)));
  if(!data)throw new Error('ProgramData missing');
  const {createHash}=await import('node:crypto');
  const binary=readFileSync(new URL('../target/deploy/ratchet_curve.so',import.meta.url));
  if(!data.data.subarray(45,45+binary.length).equals(binary))throw new Error('Deployed bytecode differs from reviewed local release');
}
const global=await c.prog.account.global.fetchNullable(c.global);
function assertConfig(){
  if(!global)throw new Error('Global missing; run ACTION=initialize explicitly');
  for(const key of Object.keys(params))if(String(global[key])!==String(params[key]))throw new Error('Global configuration mismatch: '+key);
}
const balance=await c.conn.getBalance(wallet.publicKey);
console.log(JSON.stringify({cluster,genesis,action,program:c.pid.toBase58(),signer:wallet.publicKey.toBase58(),balanceSOL:balance/1e9,globalExists:!!global}));
if(action==='preflight'){if(global)assertConfig();console.log('Preflight passed; no transaction sent');process.exit(0);}
if(action==='initialize'){
  if(global){assertConfig();console.log('Global already matches; no transaction sent');process.exit(0);}
  console.log('initialize:',await c.initialize(params));process.exit(0);
}
assertConfig();
const cap=process.env.MAX_SPEND_SOL===undefined?null:solAmount(Number(process.env.MAX_SPEND_SOL));
if(['create','complete'].includes(action)&&cap===null)throw new Error('MAX_SPEND_SOL is required for spending actions');
if(action==='create'){
  if(!process.env.METADATA_URI||!process.env.NAME||!process.env.SYMBOL||!process.env.MINT_KEYPAIR)throw new Error('NAME, SYMBOL, METADATA_URI and MINT_KEYPAIR are required');
  const uri=process.env.METADATA_URI;if(!/^(https:\/\/|ipfs:\/\/|ar:\/\/)/.test(uri)||Buffer.byteLength(uri)>200)throw new Error('Invalid permanent metadata URI');
  const dev=process.env.DEV_BUY_SOL===undefined?0n:BigInt(Math.round(Number(process.env.DEV_BUY_SOL)*1e9));
  if(dev<0n||!Number.isFinite(Number(process.env.DEV_BUY_SOL??0)))throw new Error('Invalid dev buy');
  // Conservative local budget includes metadata/account rents. Actual paid delta is printed after.
  const rentAllowance=100_000_000n;
  if(dev+rentAllowance>cap||BigInt(balance)<dev+rentAllowance)throw new Error('Create budget/balance cannot cover dev buy plus 0.1 SOL account/fee margin');
  const file=process.env.MINT_KEYPAIR;
  const mint=existsSync(file)?loadWallet(file):Keypair.generate();
  if(!existsSync(file))writeFileSync(file,JSON.stringify(Array.from(mint.secretKey)),{mode:0o600,flag:'wx'});
  const existing=await c.prog.account.bondingCurve.fetchNullable(c.pda('curve',mint.publicKey));
  if(existing){console.log('Coin already exists:',mint.publicKey.toBase58());process.exit(0);}
  console.log('create:',await c.create(mint,process.env.NAME,process.env.SYMBOL,uri,dev,cap));
  console.log('mint:',mint.publicKey.toBase58());process.exit(0);
}
if(!process.env.MINT)throw new Error('MINT is required to resume a coin');
const mint=new PublicKey(process.env.MINT);let coin=await c.fetch(mint);
if(action==='complete'){
  if(cluster==='mainnet-beta')throw new Error('Auto-completion is test-only; production liquidity comes from buyers');
  const chunk=solAmount(Number(process.env.BUY_CHUNK_SOL??'0.5'));
  // Estimate full spend BEFORE submitting any buy, using exactly the integer on-chain cap.
  let sim=quoteState(coin),needed=0n;
  for(let i=0;sim.realToken>0n&&i<10000;i++){
    const out=quoteBuy(sim,chunk);if(out===0n)throw new Error('Cannot fill with this chunk size');
    const fee=chunk*125n/10000n;sim.virtualSol+=chunk-fee;sim.virtualToken-=out;sim.realToken-=out;sim.realSol+=chunk-fee;sim.floorVault+=fee;
    // circulating is needed for floor ratchet; start from the actual chain value.
    const issued=BigInt(coin.circulating.toString())+BigInt(coin.realToken.toString())-sim.realToken;
    const f=sim.floorVault*10n**18n/issued;if(f>sim.floorScaled)sim.floorScaled=f;
    needed+=chunk;
  }
  if(sim.realToken>0n||needed+20_000_000n>cap||BigInt(balance)<needed+20_000_000n)throw new Error('Completion estimate exceeds budget/balance: '+String(needed)+' lamports plus fees');
  let spent=0n;
  while(!coin.complete){if(spent+chunk>cap)throw new Error('Spend cap reached');
    const min=minOutput(quoteBuy(quoteState(coin),chunk));
    console.log('buy:',await c.prog.methods.buy(new BN(String(chunk)),new BN(String(min))).accounts(c.trade(mint)).rpc());
    spent+=chunk;coin=await c.fetch(mint);
  }
  console.log('complete; follow-up buy SOL:',Number(spent)/1e9);process.exit(0);
}
if(action==='migrate'){
  if(coin.graduated){console.log('Already migrated:',coin.raydiumPool.toBase58());process.exit(0);}
  if(!coin.complete)throw new Error('Coin is not complete');
  const budget=migrationBudget(BigInt(coin.realSol.toString()),BigInt(coin.floorVault.toString()),BigInt(coin.floorScaled.toString()),(await getMint(c.conn,mint)).supply);
  console.log('retained floor SOL:',Number(budget.retainedFloor)/1e9,'pool SOL:',Number(budget.liquidity)/1e9);
  console.log('migrate:',await c.migrate(mint,cluster==='devnet'));
  const after=await c.fetch(mint),a=migrationAccounts(c.pid,mint,wallet.publicKey,cluster==='devnet');
  if(!after.graduated||!after.raydiumPool.equals(a.poolState)||(await getMint(c.conn,a.lpMint)).supply!==0n)throw new Error('Migration verification failed');
  console.log('verified pool:',a.poolState.toBase58());process.exit(0);
}
if(!coin.graduated)throw new Error('Floor redemption requires a migrated coin');
const raw=process.env.TOKENS_BASE_UNITS;if(!raw||!/^\d+$/.test(raw)||BigInt(raw)<=0n)throw new Error('TOKENS_BASE_UNITS must be a positive integer');
const min=minOutput(quoteSell(quoteState(coin),BigInt(raw)),0);
console.log('redeem:',await c.prog.methods.redeemFloor(new BN(raw),new BN(String(min))).accounts(c.trade(mint)).rpc());
