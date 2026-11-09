// Run against a production build configured for mainnet with its trading guard false.
// Isolated browser; RPC and wallet are mocked. It never signs or submits a transaction.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const browser=await puppeteer.launch({headless:true});
try{
 const page=await browser.newPage();await page.setViewport({width:390,height:844});
 const errors=[],methods=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);
 page.on('request',req=>{
  if(req.url().startsWith('https://api.coinbase.com/v2/prices/SOL-USD/spot')){req.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({data:{base:'SOL',currency:'USD',amount:'86.53'}})});return;}
  if(req.url().startsWith('https://api.mainnet-beta.solana.com')||req.url()==='http://127.0.0.1:3310/api/solana'){
   if(req.method()==='OPTIONS'){req.respond({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});return;}
   const body=JSON.parse(req.postData()??'{}');methods.push(body.method);
   const results={getGenesisHash:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',getProgramAccounts:[],getBalance:{context:{slot:1},value:0},getAccountInfo:{context:{slot:1},value:null}};
   req.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({jsonrpc:'2.0',id:body.id,result:results[body.method]??null})});
  }else req.continue();
 });
 await page.evaluateOnNewDocument(()=>{let key=null;window.phantom={solana:{
   get publicKey(){return key;},async connect(){key={toBase58:()=> '3vkTXSV3LG7ZrZt1SWMnEYBjNBiYAg168fbEV3Q6skTi'};return {publicKey:key};},
   async disconnect(){key=null;},async signTransaction(){throw new Error('Smoke test must never sign');},async signAllTransactions(){throw new Error('Smoke test must never sign');}
 }};});
 await page.goto('http://127.0.0.1:3310/create',{waitUntil:'networkidle0'});
 const click=async(label)=>page.evaluate(text=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===text);if(!b)throw new Error('Missing button '+text);b.click();},label);
 await click('Connect wallet');await page.waitForFunction(()=>document.body.innerText.includes('Disconnect'));
 await page.type('#coin-name','Smoke Coin');await page.type('#coin-symbol','SMOKE');await page.type('#metadata-uri','ipfs://testmetadata');
 await click('Launch coin');await page.waitForFunction(()=>document.body.innerText.includes('Mainnet trading is not enabled'));
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(x=>x.includes('wallet')||x.includes('burner'))),false);
 assert.equal(methods.includes('sendTransaction'),false);assert.equal(methods.includes('requestAirdrop'),false);
 assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'Mobile layout must not overflow');
 await page.screenshot({path:'/tmp/ratchet-v4-browser.png',fullPage:true});
 await click('Disconnect');await page.waitForFunction(()=>document.body.innerText.includes('Connect wallet'));
 writeFileSync('release/browser-proof.json',JSON.stringify({mainnetGuard:true,connectedWallet:true,disconnectedWallet:true,publicBrowserKeyStorage:false,transactionSubmissions:0,pageErrors:errors,mobileViewport:[390,844],horizontalOverflow:false},null,2)+'\n');
 console.log('BROWSER SMOKE PASS: wallet connect/disconnect, mainnet guard, no stored keys, no writes, mobile layout');
}finally{await browser.close();}
