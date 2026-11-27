// Explicit operator-only acceptance; never invoked by CI.
import {runCloud} from './local-acceptance.mjs';
const result=await runCloud(process.argv.slice(2));
console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
