import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeConversations, requestedAccess, type Conversation} from '../src/core/conversation.ts';

test('salva una conversazione prima che esista una specifica', () => {
 const draft: Conversation = {id:'p1', name:'Erbario', turns:[{role:'user',text:'Catalogo delle piante.',requestId:'p-turno-1'}]};
 assert.deepEqual(decodeConversations(JSON.stringify([draft])), [draft]);
 assert.throws(() => decodeConversations(JSON.stringify([draft, draft])), /Cronologia/);
});

test('gli accessi seguono le richieste utente e ignorano le proposte del motore', () => {
 const project: Conversation = {id:'p1',name:'Erbario',turns:[
  {role:'user',text:'Collega GitHub e Firebase.'},
  {role:'assistant',text:'Propongo anche Stripe.'},
  {role:'user',text:'Rimuovi Firebase. Pubblica su Google Play.'},
 ]};
 assert.deepEqual(requestedAccess([project]).map(row => row.name), ['GitHub','Google Play Console']);
});

test('recupera le conversazioni dal backup senza sovrascriverlo durante un ripristino interrotto', async () => {
  const {createConversationRepository} = await import('../src/core/conversation.ts');
  const data = new Map<string, string>();
  const key = 'forgia.conversations.v1';
  let interrupt = false;
  const repository = createConversationRepository({
    async getItem(key) { return data.get(key) ?? null; },
    async setItem(key, value) {
      if (interrupt && key === 'forgia.conversations.v1') throw Error('Scrittura interrotta');
      data.set(key, value);
    },
  });
  const original = [{id: 'p1', name: 'Erbario', turns: [{role: 'user' as const, text: 'Catalogo di piante.'}]}];
  await repository.save(original);
  await repository.save([{...original[0], name: 'Orto'}]);
  data.set(key, '{');
  assert.deepEqual(await repository.load(), {projects: original, recovered: true});
  interrupt = true;
  await assert.rejects(repository.save(original), /Scrittura interrotta/);
  assert.deepEqual(await repository.load(), {projects: original, recovered: true});
});
