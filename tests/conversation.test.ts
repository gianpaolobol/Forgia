import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeConversations, requestedAccess, type Conversation} from '../src/core/conversation.ts';

test('salva una conversazione prima che esista una specifica', () => {
 const draft: Conversation = {id:'p1', name:'Erbario', turns:[{role:'user',text:'Catalogo delle piante.'}]};
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
