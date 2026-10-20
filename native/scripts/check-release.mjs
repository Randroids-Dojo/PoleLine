import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function files(path){return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?['build','.cxx','.gradle','DerivedData'].includes(e.name)?[]:files(resolve(path,e.name)):[resolve(path,e.name)]);}
const runtime=[...files(resolve(root,'shared')),...files(resolve(root,'android/app/src/main')),...files(resolve(root,'ios/PoleLine'))];
const prohibited=/\bF1\b|Formula\s*(1|One)|\bFIA\b|Ferrari|McLaren|Mercedes|Red Bull|Pirelli|Suzuka|Monaco|Monza|Silverstone|Verstappen|Hamilton|WKWebView|\bWebView\b|URLSession|URLConnection|OkHttp|\bfetch\s*\(/i;
let failures=[];
for(const path of runtime){if(!['.cpp','.h','.mm','.swift','.kt','.inc','.xml','.json'].includes(extname(path)))continue;const text=readFileSync(path,'utf8');if(prohibited.test(text))failures.push(path);}
const manifest=readFileSync(resolve(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
if(/uses-permission/.test(manifest))failures.push('Android has a permission declaration');
const circuits=JSON.parse(readFileSync(resolve(root,'shared/generated/circuits.json'),'utf8'));
if(circuits.length!==25||new Set(circuits.map(c=>c.id)).size!==25)failures.push('Expected 25 distinct fictional circuits');
if(failures.length){console.error(failures);process.exit(1);}
console.log(`Native content scan passed: ${runtime.length} runtime files, 25 fictional circuits, no network clients or sporting references, no Android permissions.`);
