import type {TurboUpload} from '@ardrive/turbo-upload';
export function turboClient(file?:string):TurboUpload;
export function assertFreeUpload(client:any,size:number):Promise<any>;
export function uploadFreeTurbo(client:any,bytes:Uint8Array,type:string,onPrepared?:(record:any)=>void):Promise<any>;
export function verifyTurbo(uri:string,expected:Uint8Array,options?:{fetcher?:typeof fetch;attempts?:number;pause?:()=>Promise<void>}):Promise<{sha256:string;contentType:string|null;gatewayVerified:boolean;chainStable:boolean}>;
