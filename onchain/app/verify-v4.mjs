// Local integration proof using cloned MAINNET Raydium and Metaplex executables.
import assert from 'node:assert/strict';
import {Keypair,PublicKey,SystemProgram,Transaction,TransactionInstruction,sendAndConfirmTransaction} from '@solana/web3.js';
import {getMint,getAccount,createMint,getOrCreateAssociatedTokenAccount,mintTo} from '@solana/spl-token';
import {client,loadWallet,BN,quoteState,migrationAccounts} from './client.mjs';
import {PRODUCTION,quoteBuy,quoteSell,minOutput,migrationBudget,SCALE} from '../../lib/protocol.ts';
import {metadataPda} from '../../lib/raydium.ts';
const wallet=(process.env.VERIFY_WALLET?loadWallet(process.env.VERIFY_WALLET):Keypair.fromSeed(new Uint8Array(32).fill(7)));
const c=client('http://127.0.0.1:18999',wallet);
const mainnetGenesis='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
assert.notEqual(await c.conn.getGenesisHash(),mainnetGenesis);
const bad=Keypair.generate();await c.conn.confirmTransaction(await c.conn.requestAirdrop(bad.publicKey,1e9),'confirmed');
const attacker=client(c.conn.rpcEndpoint,bad);
const reject=async(label,fn,pattern)=>{await assert.rejects(fn,pattern);console.log('REJECTED:',label);};
if(!await c.prog.account.global.fetchNullable(c.global)) {
  await reject('unauthorized initialization',()=>attacker.initialize(PRODUCTION),/Unauthorized|unauthorized/);
  await reject('invalid global economics',()=>c.initialize({...PRODUCTION,feeBps:0}),/BadParams|bad parameters/);
  await c.initialize(PRODUCTION);
}
const mint=Keypair.generate();
const uri='https://example.com/ratchet-test.json';
await reject('invalid metadata URI',()=>c.create(Keypair.generate(),'Bad','BAD','javascript:invalid',0n),/BadParams|bad parameters/);
await reject('simulated create over budget',()=>c.create(Keypair.generate(),'Budget','BDGT',uri,1_000_000_000n,1n),/spend exceeds/);
await c.create(mint,'Ratchet v4','RV4',uri,1_000_000_000n,2_000_000_000n);
let chain=await c.fetch(mint.publicKey);
const {RatchetCurve,DEFAULT_PARAMS}=await import('../../lib/ratchet.ts');const model=new RatchetCurve({...DEFAULT_PARAMS,sellFeeBps:250n});model.devBuy(1_000_000_000n);
const metadata=await c.conn.getAccountInfo(metadataPda(mint.publicKey));assert.ok(metadata&&metadata.data.includes(Buffer.from(uri)));
let mo=65;
for(let i=0;i<3;i++){const n=metadata.data.readUInt32LE(mo);mo+=4+n;}
mo+=2;
if(metadata.data[mo++]===1){const count=metadata.data.readUInt32LE(mo);mo+=4+count*34;}
assert.equal(metadata.data[mo+1],0,'Metaplex metadata must be immutable');
assert.equal((await getMint(c.conn,mint.publicKey)).mintAuthority,null);
console.log('CREATE: immutable metadata and revoked mint authority verified');
for(let i=0;i<3;i++){
  const amount=5_000_000_000n;const expected=quoteBuy(quoteState(chain),amount);
  await c.prog.methods.buy(new BN(String(amount)),new BN(String(minOutput(expected)))).accounts(c.trade(mint.publicKey)).rpc();
  model.buy(amount);chain=await c.fetch(mint.publicKey);assert.equal(chain.circulating.toString(),String(model.circulating));
}
let tokens=model.circulating/20n;let expected=quoteSell(quoteState(chain),tokens);
await reject('sell slippage',()=>c.prog.methods.sell(new BN(String(tokens)),new BN(String(expected+1n))).accounts(c.trade(mint.publicKey)).rpc(),/Slippage|slippage/);
await c.prog.methods.sell(new BN(String(tokens)),new BN(String(minOutput(expected)))).accounts(c.trade(mint.publicKey)).rpc();model.sell(tokens);
chain=await c.fetch(mint.publicKey);
let buys=15n;
for(let i=0;i<200&&!chain.complete;i++){
  const amount=5_000_000_000n, out=quoteBuy(quoteState(chain),amount);
  await c.prog.methods.buy(new BN(String(amount)),new BN(String(minOutput(out)))).accounts(c.trade(mint.publicKey)).rpc();
  model.buy(amount);chain=await c.fetch(mint.publicKey);buys+=5n;
  assert.equal(chain.circulating.toString(),String(model.circulating));
  assert.equal(chain.floorVault.toString(),String(model.floorVault));
  assert.equal(chain.realSol.toString(),String(model.realSol));
  if(i%30===0)console.log('LIFECYCLE:',String(buys),'SOL follow-up buys; engine/chain parity');
}
assert.equal(chain.complete,true);
const before=quoteState(chain),supply=(await getMint(c.conn,mint.publicKey)).supply;
const budget=migrationBudget(before.realSol,before.floorVault,before.floorScaled,supply);
const crank=Keypair.generate();await c.conn.confirmTransaction(await c.conn.requestAirdrop(crank.publicKey,10_000_000),'confirmed');
const crankClient=client(c.conn.rpcEndpoint,crank);const a=migrationAccounts(c.pid,mint.publicKey,crank.publicKey);
await reject('substitute CPI program',()=>crankClient.migrate(mint.publicKey,false,{cpSwapProgram:SystemProgram.programId}),/ConstraintAddress|address constraint/);
await reject('substitute pool',()=>crankClient.migrate(mint.publicKey,false,{poolState:bad.publicKey}),/InvalidPool|invalid Raydium/);
for(const key of ['lpMint','creatorLpToken','token0Vault','token1Vault','observationState','authority'])
  await reject('substitute '+key,()=>crankClient.migrate(mint.publicKey,false,{[key]:bad.publicKey}),/InvalidPool|invalid Raydium/);
await reject('substitute token program',()=>crankClient.migrate(mint.publicKey,false,{token0Program:SystemProgram.programId}),/ConstraintAddress|address constraint/);
for(const name of ['graduate','release_for_migration','swap']){
  const {createHash}=await import('node:crypto');const disc=createHash('sha256').update('global:'+name).digest().subarray(0,8);
  await reject('removed '+name,()=>sendAndConfirmTransaction(c.conn,new Transaction().add(new TransactionInstruction({programId:c.pid,keys:[],data:disc})),[wallet]),/fallback|Fallback|not found|101/);
}
const vaultBefore=await c.conn.getBalance(c.pda('sol',mint.publicKey));
const sig=await crankClient.migrate(mint.publicKey);chain=await c.fetch(mint.publicKey);
assert.equal(chain.graduated,true);assert.equal(chain.raydiumPool.toBase58(),a.poolState.toBase58());
assert.equal(chain.floorVault.toString(),String(budget.retainedFloor));assert.equal(chain.circulating.toString(),String(supply));
assert.equal((await getMint(c.conn,a.lpMint)).supply,0n);
assert.ok((await c.conn.getAccountInfo(a.poolState)).owner.equals(a.cpSwapProgram));
assert.equal(BigInt(vaultBefore-await c.conn.getBalance(c.pda('sol',mint.publicKey))),before.realSol-budget.topUp);
console.log('MIGRATION:',sig,'pool',a.poolState.toBase58(),'LP=0, full-supply floor backing retained, 0.01-SOL crank');
await reject('repeat migration',()=>crankClient.migrate(mint.publicKey),/NotComplete|curve not complete/);
await reject('curve sell after migration',()=>c.prog.methods.sell(new BN(1),new BN(0)).accounts(c.trade(mint.publicKey)).rpc(),/AlreadyMigrated|coin has migrated/);
let holder=await getAccount(c.conn,c.trade(mint.publicKey).userAta);tokens=holder.amount/3n;
const floor=tokens*BigInt(chain.floorScaled.toString())/SCALE;
await reject('redemption slippage',()=>c.prog.methods.redeemFloor(new BN(String(tokens)),new BN(String(floor+1n))).accounts(c.trade(mint.publicKey)).rpc(),/Slippage|slippage/);
const vaultStart=await c.conn.getBalance(c.pda('sol',mint.publicKey));
await c.prog.methods.redeemFloor(new BN(String(tokens)),new BN(String(floor))).accounts(c.trade(mint.publicKey)).rpc();
chain=await c.fetch(mint.publicKey);
assert.equal(vaultStart-await c.conn.getBalance(c.pda('sol',mint.publicKey)),Number(floor));
assert.equal((await getMint(c.conn,mint.publicKey)).supply,supply-tokens);
assert.ok(BigInt(chain.floorVault.toString())*SCALE>=BigInt(chain.circulating.toString())*BigInt(chain.floorScaled.toString()));
console.log('REDEMPTION: exact payout, burn, remaining backing verified');
const migrationTx=await c.conn.getTransaction(sig,{commitment:'confirmed',maxSupportedTransactionVersion:0});
assert.ok(migrationTx?.meta&&!migrationTx.meta.err,'Migration transaction metadata missing');
const computeUnits=migrationTx.meta.computeUnitsConsumed;
assert.ok(computeUnits>0 && computeUnits<=600_000,'Migration exceeds client compute limit');
console.log('MIGRATION COMPUTE UNITS:',computeUnits,'/ 600000');
const {writeFileSync,readFileSync}=await import('node:fs');const {createHash}=await import('node:crypto');
writeFileSync('release/'+(process.env.EXACT_RELEASE?'exact-bytecode-proof':'local-proof')+'.json',JSON.stringify({
  kind:process.env.EXACT_RELEASE?'mainnet-bytecode-local-validator':'test-admin-bytecode-local-validator',
  mainnetDependenciesCloned:true,program:c.pid.toBase58(),mint:mint.publicKey.toBase58(),pool:a.poolState.toBase58(),migrationSignature:sig,
  artifactSha256:createHash('sha256').update(readFileSync('onchain/target/deploy/ratchet_curve.so')).digest('hex'),
  productionParams:true,engineParity:true,metadataImmutable:true,lpSupply:'0',fullSupplyFloorBacking:true,redemption:true,
  migrationComputeUnits:computeUnits,migrationComputeLimit:600_000,
},null,2)+'\n');
const {spawnSync}=await import('node:child_process');
const cli=(env)=>spawnSync(process.execPath,['--experimental-strip-types','onchain/app/launch-mainnet.mjs'],{
  env:{...process.env,WALLET:process.env.VERIFY_WALLET,RPC_URL:c.conn.rpcEndpoint,CLUSTER:'localnet',MODE:'prod',...env},encoding:'utf8'});
let probe=cli({ACTION:'preflight'});assert.equal(probe.status,0,probe.stderr);assert.match(probe.stdout,/no transaction sent/);
probe=cli({ACTION:'preflight',CLUSTER:'mainnet-beta'});assert.notEqual(probe.status,0);assert.match(probe.stderr,/genesis\/cluster mismatch/);
probe=cli({ACTION:'preflight',MODE:'test'});assert.notEqual(probe.status,0);assert.match(probe.stderr,/configuration mismatch/);
console.log('CLI: read-only preflight, wrong genesis and test/prod mismatch verified');
console.log('V4 INTEGRATION PASS');
