// Replace bigint-buffer's unpatched native addon with bounded native BigInt arithmetic.
const { Buffer } = require('buffer');
function decode(bytes, little) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 1024) throw new TypeError('Expected bytes');
  let n=0n;
  for(let i=0;i<bytes.length;i++)n=(n<<8n)+BigInt(bytes[little?bytes.length-i-1:i]);
  return n;
}
function encode(n,width,little) {
  if(typeof n!=='bigint'||n<0n||!Number.isInteger(width)||width<0||width>1024)throw new RangeError('Invalid unsigned integer or width');
  const b=Buffer.alloc(width);
  for(let i=0;i<width;i++){b[little?i:width-i-1]=Number(n&255n);n>>=8n;}
  if(n!==0n)throw new RangeError('Integer exceeds width');
  return b;
}
exports.toBigIntLE=b=>decode(b,true);
exports.toBigIntBE=b=>decode(b,false);
exports.toBufferLE=(n,w)=>encode(n,w,true);
exports.toBufferBE=(n,w)=>encode(n,w,false);
