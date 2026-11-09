export function metadataInput(image:string,name:string,symbol:string,description?:string):{bytes:Buffer;type:string;name:string;symbol:string;description:string};
export function pinFile(bytes:Uint8Array,type:string,filename:string,options?:{token?:string;fetcher?:typeof fetch}):Promise<string>;
export function verifyPinned(uri:string,expected:Uint8Array,options?:{fetcher?:typeof fetch;gateway?:string}):Promise<void>;
