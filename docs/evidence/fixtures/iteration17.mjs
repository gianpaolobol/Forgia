// Run from a checkout of #4 fed1b414: node /path/to/iteration17.mjs [checkout-root]
// No network, React runtime, credentials or native build. Extracts the exact routing expressions.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root=process.argv[2]??process.cwd();
const paths=['app.config.js','src/ui/useWorkspace.ts','src/core/lanPilot.ts','app.json'];
const hashes=['664b4d981900d6930bc2f41e0a9cb1cf021f90cb','25f373be87d06270c08471b6d554f955b26858e4','93eb750a61950a64fae19ff1b145d9f0bfb7bcd2','1604341faa4078c94f66739326c59795b6e0d4e4'];
const [cfg,ws,lan,app]=paths.map((p,i)=>{
  const buf=readFileSync(join(root,p));
  const sha=createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');
  if(sha!==hashes[i]) throw Error('Unexpected Git blob: '+p+' '+sha);
  return buf.toString('utf8');
});
const source=ws.slice(ws.indexOf('const iosLanPilot'),ws.indexOf('async function gatewayRequest'))+ws.slice(ws.indexOf('  const nativePilot'),ws.indexOf('  const [engineNote'))+'return {nativePilot,api};';
const strict=new Function(lan.replace('export function','function').replace('value: string','value').replace(': string | undefined','')+'\nreturn lanPilotOrigin;')();
const run=new Function('Platform','process','lanPilotOrigin','pilotAddress',source);
const configFn=new Function('process',cfg.replace('export default','return'));
const base=JSON.parse(app).expo;
const cases=[
 ['standard android no env','android',{},false,undefined],
 ['standard ios no env','ios',{},false,undefined],
 ['standard android configured public hostname','android',{EXPO_PUBLIC_FORGIA_PILOT_URL:'https://example.com'},false,undefined],
 ['standard ios configured public hostname','ios',{EXPO_PUBLIC_FORGIA_PILOT_URL:'https://example.com'},false,undefined],
 ['standard android configured private hostname','android',{EXPO_PUBLIC_FORGIA_PILOT_URL:'https://192.168.1.11:8443'},false,undefined],
 ['ios explicit pilot private','ios',{EXPO_PUBLIC_FORGIA_IOS_LAN_PILOT:'1',EXPO_PUBLIC_FORGIA_PILOT_URL:'https://192.168.1.11:8443'},true,'https://192.168.1.11:8443'],
 ['ios explicit pilot public','ios',{EXPO_PUBLIC_FORGIA_IOS_LAN_PILOT:'1',EXPO_PUBLIC_FORGIA_PILOT_URL:'https://example.com'},true,undefined]
];
let passed=0,failed=0;
for(let i=0;i<3;i++) for(const [name,os,env,wantPilot,wantApi] of cases){
 const c=configFn({env})({config:base});
 const v=run({OS:os},{env},strict,env.EXPO_PUBLIC_FORGIA_PILOT_URL??'');
 const pass=v.nativePilot===wantPilot&&v.api===wantApi;
 if(pass)passed++;else failed++;
 console.log(JSON.stringify({i:i+1,name,...v,pass,configPackage:c.android.package,iosBuild:c.ios.buildNumber}));
}
console.log({passed,failed});
process.exitCode=failed?1:0;
