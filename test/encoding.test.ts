import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {MintLayout,AccountLayout} from '@solana/spl-token';
const {toBigIntLE,toBigIntBE,toBufferLE,toBufferBE}=createRequire(import.meta.url)('../packages/bigint-buffer/index.cjs');
test('native-free integer codec roundtrips Solana widths and rejects truncation',()=>{
  for(const width of [0,1,8,16,24,32])for(const value of [0n,1n,255n,(1n<<BigInt(width*8))-1n]){
    if(value>=(1n<<BigInt(width*8)))continue;
    assert.equal(toBigIntLE(toBufferLE(value,width)),value);
    assert.equal(toBigIntBE(toBufferBE(value,width)),value);
  }
  assert.equal(toBufferLE(0x1234n,4).toString('hex'),'34120000');
  assert.equal(toBufferBE(0x1234n,4).toString('hex'),'00001234');
  assert.throws(()=>toBufferLE(-1n,8));assert.throws(()=>toBufferBE(256n,1));
  assert.throws(()=>toBufferLE(1n,1.5));assert.throws(()=>toBufferLE(1n,1025));
});
test('SPL account layouts use the replacement codec with unchanged public values',()=>{
  const mint=Buffer.alloc(MintLayout.span);mint.writeBigUInt64LE(12345678901234567890n,36);
  assert.equal(MintLayout.decode(mint).supply,12345678901234567890n);
  const account=Buffer.alloc(AccountLayout.span);account.writeBigUInt64LE(999999999999999n,64);
  assert.equal(AccountLayout.decode(account).amount,999999999999999n);
});
