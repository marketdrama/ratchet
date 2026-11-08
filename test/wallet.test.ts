import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,Transaction,SystemProgram} from '@solana/web3.js';
import {walletAdapter,connectWallet,disconnectWallet,walletAddress,LOCAL_RPC} from '../lib/wallet.ts';
test('public wallet signing requires explicit connection and never creates a local key',async()=>{
  const wallet=Keypair.generate();let signed=0;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem(){throw new Error('Public wallets must not read local keys');},setItem(){throw new Error('Public wallets must not store keys');}}});
  const injected={publicKey:null as typeof wallet.publicKey|null,
    async connect(){this.publicKey=wallet.publicKey;return {publicKey:wallet.publicKey};},
    async disconnect(){this.publicKey=null;},
    async signTransaction<T extends Transaction>(tx:T){signed++;tx.partialSign(wallet);return tx;},
    async signAllTransactions(txs:Transaction[]){return Promise.all(txs.map(tx=>this.signTransaction(tx)));}};
  Object.defineProperty(globalThis,'window',{configurable:true,value:{phantom:{solana:injected}}});
  const adapter=walletAdapter(false);
  await assert.rejects(()=>adapter.signTransaction(new Transaction()),/Connect/);
  assert.equal(walletAddress(false),null);
  await connectWallet();assert.equal(walletAddress(false)?.toBase58(),wallet.publicKey.toBase58());
  const tx=new Transaction({feePayer:wallet.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()})
    .add(SystemProgram.transfer({fromPubkey:wallet.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1}));
  await adapter.signTransaction(tx);assert.equal(signed,1);assert.ok(tx.verifySignatures());
  await disconnectWallet();await assert.rejects(()=>adapter.signTransaction(new Transaction()),/Connect/);
  assert.equal(LOCAL_RPC('https://mainnet.example.com'),false);
  assert.equal(LOCAL_RPC('http://127.0.0.1:18999'),true);
});
