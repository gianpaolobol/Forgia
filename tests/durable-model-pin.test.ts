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
