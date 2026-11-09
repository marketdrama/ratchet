import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {PublicKey} from '@solana/web3.js';
const root=fileURLToPath(new URL('../',import.meta.url));
export const sha=b=>createHash('sha256').update(b).digest('hex');
export async function verifyRelease(){
  const m=JSON.parse(readFileSync(resolve(root,'release/manifest.json')));
  if(m.features.length||m.program!=='35UELzdncBr15qztq55Kct3sZvmXnn5D5e5rpGiHgMuC'||m.cluster!=='mainnet-beta')throw new Error('Not a mainnet release manifest');
  if(Object.keys(m.sha256).some(f=>f.includes('node_modules')||f.includes('keypair')))throw new Error('Unexpected generated/private release input');
  for(const [file,hash] of Object.entries(m.sha256))if(sha(readFileSync(resolve(root,file)))!==hash)throw new Error('Release file changed: '+file);
  const isolated=JSON.parse(readFileSync(resolve(root,'release/isolated-build.json')));
  if(isolated.artifactSha256!==m.artifactSha256||isolated.matchingFreshBuilds<2||isolated.image!==m.buildEnvironment)throw new Error('Missing matching repeated isolated build proof');
  for(const [file,hash] of Object.entries(isolated.sourceSha256))if(sha(readFileSync(resolve(root,'onchain',file)))!==hash)throw new Error('Isolated build input changed: '+file);
  if(isolated.features.length||isolated.platformTools!=='v1.44')throw new Error('Unexpected isolated build configuration');
  const binary=readFileSync(resolve(root,'onchain/target/deploy/ratchet_curve.so'));
  for(const key of ['3vkTXSV3LG7ZrZt1SWMnEYBjNBiYAg168fbEV3Q6skTi','CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'])
    if(!binary.includes(new PublicKey(key).toBuffer()))throw new Error('Production constant missing in bytecode');
  for(const key of ['GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB','DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb'])
    if(binary.includes(new PublicKey(key).toBuffer()))throw new Error('Test constant found in mainnet bytecode');
  const idl=JSON.parse(readFileSync(resolve(root,'lib/idl.json')));
  if(idl.address!==m.program)throw new Error('IDL address mismatch');
  const actual=idl.instructions.map(x=>x.name).sort();
  const wanted=['buy','create','initialize','migrate_to_raydium','redeem_floor','sell'].sort();
  if(JSON.stringify(actual)!==JSON.stringify(wanted))throw new Error('Unexpected instruction surface');
  console.log('Release manifest verified:',m.artifactSha256);
  return m;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await verifyRelease();
