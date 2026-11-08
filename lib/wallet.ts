"use client";
import { Keypair, PublicKey, Transaction, type VersionedTransaction } from "@solana/web3.js";
export const LOCAL_RPC = (url: string) => {const u=new URL(url); return ["localhost","127.0.0.1","[::1]"].includes(u.hostname);};
type Tx=Transaction|VersionedTransaction;
interface InjectedWallet {
  publicKey: PublicKey | null;
  connect(): Promise<{publicKey:PublicKey}>;
  disconnect(): Promise<void>;
  signTransaction<T extends Tx>(tx:T):Promise<T>;
  signAllTransactions<T extends Tx>(tx:T[]):Promise<T[]>;
}
let connected: InjectedWallet | null=null;
let local: Keypair | null=null;
const readonly=Keypair.generate().publicKey;
export function localWallet():Keypair {
  if(!local){const saved=localStorage.getItem('ratchet-local-test-wallet');
    local=saved?Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved))):Keypair.generate();
    if(!saved)localStorage.setItem('ratchet-local-test-wallet',JSON.stringify(Array.from(local.secretKey)));}
  return local;
}
export async function connectWallet():Promise<PublicKey>{
  const w=window as unknown as {phantom?:{solana?:InjectedWallet};solflare?:InjectedWallet;solana?:InjectedWallet};
  const candidate=w.phantom?.solana??w.solflare??w.solana;
  if(!candidate)throw new Error('Install Phantom or Solflare to connect a wallet');
  const result=await candidate.connect();connected=candidate;return result.publicKey;
}
export async function disconnectWallet(){await connected?.disconnect();connected=null;}
export function walletAddress(localMode=false):PublicKey|null{return localMode?localWallet().publicKey:connected?.publicKey??null;}
export function walletAdapter(localMode:boolean){return {
  get publicKey(){return walletAddress(localMode)??readonly;},
  async signTransaction<T extends Tx>(tx:T):Promise<T>{
    if(localMode){if(tx instanceof Transaction)tx.partialSign(localWallet());else tx.sign([localWallet()]);return tx;}
    if(!connected?.publicKey)throw new Error('Connect your wallet first');
    return connected.signTransaction(tx);
  },
  async signAllTransactions<T extends Tx>(txs:T[]):Promise<T[]>{
    if(!localMode){if(!connected?.publicKey)throw new Error('Connect your wallet first');return connected.signAllTransactions(txs);}
    for(const tx of txs)await this.signTransaction(tx);return txs;
  },
};}
