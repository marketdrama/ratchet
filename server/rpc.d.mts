export const MAX_RPC_BYTES:number;
export function forwardRpc(body:string,options?:{url?:string;fetcher?:typeof fetch}):Promise<Response>;
