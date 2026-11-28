import {test} from 'node:test';
import assert from 'node:assert/strict';
import {durableInputPayload,durableModelAllowed} from '../server/durableInput.ts';
import {inputPayload} from '../server/legacyJobMigration.ts';
const legacy={idea:'Catalogo',provider:'local',consent:false,context:{kind:'catalog',phase:'draft'}};
test('MP1 legacy byte-compatible and canonical optional model pin',()=>{
 assert.equal(durableInputPayload(legacy),inputPayload(legacy));
 const pin={...legacy,expectedModel:'qwen:7b'};
 assert.deepEqual(JSON.parse(durableInputPayload(pin)),pin);
 assert.throws(()=>inputPayload(pin)); // offline legacy format remains frozen
 for(const value of [{...pin,provider:'auto'},{...pin,provider:'groq'},{...pin,consent:true},{...pin,expectedModel:null},{...pin,expectedModel:undefined},{...pin,expectedModel:'qwen-cloud'},{...pin,expectedModel:'https://example.invalid'},{...pin,extra:true}])assert.throws(()=>durableInputPayload(value));
});
test('MP2 model identity is exact, unavailable or changed profile is denied',()=>{
 const pin=JSON.parse(durableInputPayload({...legacy,expectedModel:'qwen:7b'}));
 assert.equal(durableModelAllowed(pin,()=> 'qwen:7b'),true);
 assert.equal(durableModelAllowed(pin,()=> 'qwen:3b'),false);
 assert.equal(durableModelAllowed(pin,()=>undefined),false);
 assert.equal(durableModelAllowed(pin),false);
 assert.equal(durableModelAllowed(JSON.parse(durableInputPayload(legacy))),true);
 assert.equal(durableModelAllowed({...pin,provider:'groq'}),false);
});

import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJobLedger} from '../server/jobLedger.ts';
import {runOneDurableJob} from '../server/durableWorker.ts';
import {QuotaDeferral} from '../server/quotaDeferral.ts';
test('MP3 quota deferral persists pin across reopen and changed model prevents dispatch',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'forgia-pin-')),path=join(dir,'jobs.sqlite');
 const session='00000000-0000-0000-0000-000000000001';
 let db=openJobLedger(path),now=1000,model='qwen:7b',calls=0;
 const payload=durableInputPayload({...legacy,expectedModel:model});
 const run=()=>runOneDurableJob(db,{worker:'worker',now:()=>now,authorize:async(_session,input)=>durableModelAllowed(input,()=>model),run:async(input)=>{
  assert.equal(input.expectedModel,'qwen:7b');calls++;throw new QuotaDeferral(now+60000);
 }});
 try{
  const id=db.enqueue(session,'pin',payload);
  assert.equal(await run(),'deferred');assert.equal(calls,1);
  db.close();db=openJobLedger(path);model='qwen:3b';
  assert.equal(db.enqueue(session,'pin',payload),id);
  assert.throws(()=>db.enqueue(session,'pin',durableInputPayload({...legacy,expectedModel:model})),/Chiave/);
  assert.equal(await run(),'idle');now+=60000;
  assert.equal(await run(),'failed');assert.equal(calls,1);
  assert.equal(JSON.parse(db.read(id,session)!.result!).statusCode,403);
  assert.equal(await run(),'idle');
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
