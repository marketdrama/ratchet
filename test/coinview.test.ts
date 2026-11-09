import {test} from 'node:test';
import assert from 'node:assert/strict';
import {view} from '../lib/coinview.ts';
import type {CoinAccount} from '../lib/chain.ts';
test('market capitalization uses remaining mint supply after floor burns',()=>{
 const coin={mint:'mint',name:'Name',symbol:'SYM',creator:'creator',virtualSol:30_000_000_000n,virtualToken:1_000_000_000_000_000n,realToken:500n,initialRealToken:1000n,totalSupply:1_000_000_000_000_000n,floorVault:1_000_000_000n,floorScaled:10n,sellFeeBps:125,complete:false,graduated:false,poolAddress:'',poolTokens:0n,marketSol:0n} as CoinAccount;
 const before=view(coin),after=view({...coin,totalSupply:coin.totalSupply/2n});assert.equal(after.mcSol,before.mcSol/2);assert.equal(before.mcUsd,null);assert.equal(before.usdObservedAt,null);
});
