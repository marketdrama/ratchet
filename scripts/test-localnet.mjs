// Starts an isolated validator, clones live mainnet dependencies, loads the test-admin
// build at genesis and runs real instructions. No public-network writes.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,copyFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Connection,PublicKey,Keypair} from '@solana/web3.js';
import anchor from '@coral-xyz/anchor';
import {readFileSync} from 'node:fs';
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{stdio:'inherit'});if(r.status!==0)throw new Error(cmd+' failed');};
const ledger=mkdtempSync(join(tmpdir(),'ratchet-v4-'));
const exact=process.argv.includes('--release');
const testWallet=Keypair.fromSeed(new Uint8Array(32).fill(7));
const testWalletFile=join(ledger,'test-only-wallet.json');
writeFileSync(testWalletFile,JSON.stringify(Array.from(testWallet.secretKey)),{mode:0o600});
console.log('Isolated validator ledger:',ledger);
if(!exact)run('cargo',['build-sbf','--manifest-path','onchain/programs/ratchet-curve/Cargo.toml','--features','test-admin','--tools-version','v1.44','--','--locked']);
const conn=new Connection('http://127.0.0.1:18999','confirmed');
try{await conn.getGenesisHash();throw new Error('Port 18999 is occupied; stop your existing test validator before running this harness');}catch(e){if(String(e).includes('occupied'))throw e;}
const extra=[];
if(exact){
  const idl=JSON.parse(readFileSync('lib/idl.json'));
  const [global,bump]=PublicKey.findProgramAddressSync([Buffer.from('global')],new PublicKey(idl.address));
  const {PRODUCTION}=await import('../lib/protocol.ts');
  const coder=new anchor.BorshAccountsCoder(idl);
  const data=await coder.encode('Global',{admin:new PublicKey('3vkTXSV3LG7ZrZt1SWMnEYBjNBiYAg168fbEV3Q6skTi'),
    ...Object.fromEntries(Object.entries(PRODUCTION).map(([k,v])=>[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),typeof v==='bigint'?new anchor.BN(String(v)):v])),bump});
  const file=join(ledger,'global-fixture.json');
  writeFileSync(file,JSON.stringify({pubkey:global.toBase58(),account:{lamports:10_000_000,data:[data.toString('base64'),'base64'],owner:idl.address,executable:false,rentEpoch:0}}));
  extra.push('--account',global.toBase58(),file);
}
const validator=spawn('solana-test-validator' ,['--ledger',ledger,'--rpc-port','18999','--faucet-port','19031','--gossip-port','19001','--dynamic-port-range','19002-19030',
 '--url','https://api.mainnet-beta.solana.com','--clone-upgradeable-program','CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
 '--clone-upgradeable-program','metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s','--clone','D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2',
 '--clone','DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8','--bpf-program','35UELzdncBr15qztq55Kct3sZvmXnn5D5e5rpGiHgMuC','onchain/target/deploy/ratchet_curve.so',...extra,'--quiet'],{stdio:'inherit'});
try{
  let ready=false;
  for(let i=0;i<120;i++){try{await conn.getGenesisHash();ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}
  if(!ready)throw new Error('Validator failed to start; ledger '+ledger);
  run('solana',['airdrop','2000',testWallet.publicKey.toBase58(),'--url',conn.rpcEndpoint]);
  process.env.VERIFY_WALLET=testWalletFile;
  if(exact)process.env.EXACT_RELEASE='true';
  run(process.execPath,['--experimental-strip-types','onchain/app/verify-v4.mjs']);
}finally{validator.kill('SIGINT');}
