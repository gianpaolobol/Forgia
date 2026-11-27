import {test, expect} from '@playwright/test';

test('dall’idea alla chat, al risultato AI e agli accessi per progetto', async ({page}) => {
  await page.route('http://127.0.0.1:8787/**', async route => {
    const headers = {'access-control-allow-origin':'*', 'access-control-allow-headers':'content-type,idempotency-key',
      'access-control-allow-methods':'GET, POST, OPTIONS'};
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    const path = new URL(route.request().url()).pathname;
    if (path === '/providers') return route.fulfill({headers, json: {providers:[{id:'llamacpp', model:'Qwen test', configured:true}]}});
    if (path === '/jobs') return route.fulfill({status: 202, headers, json:{id:'00112233-4455-6677-8899-aabbccddeeff'}});
    return route.fulfill({headers, json: {status:'done', result:{routing:{model:'Qwen test'}, spec:{
      name:'Erbario', idea:'Il catalogo è pronto per una prima verifica.', kind:'catalog', quiz:false,
      items:[{name:'Lavanda',category:'Aromatiche',color:''}],
    }}}});
  });
  await page.setViewportSize({width: 375, height: 812});
  await page.goto('/');
  await page.getByRole('button',{name:'Crea un progetto'}).click();
  await expect(page.getByText('Scegli la famiglia')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Detta con il microfono'})).toBeVisible();
  await page.getByLabel('Nome della tua app').fill('Erbario di Gian');
  await page.getByLabel('Descrivi la tua idea').fill('Crea un catalogo con Lavanda e collega un repository GitHub.');
  await page.getByRole('button',{name:'Avvia la chat'}).click();
  await expect(page.getByText('Il catalogo è pronto per una prima verifica.')).toBeVisible();
  await page.getByRole('button', {name: 'Anteprima catalogo'}).click();
  await expect(page.getByText('Lavanda', {exact: true})).toBeVisible();
  await expect(page.getByText('Aromatiche', {exact: true})).toBeVisible();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Esporta sorgenti ZIP'}).click();
  expect((await download).suggestedFilename()).toMatch(/erbario-di-gian.*zip/);
  await page.getByRole('button',{name:'Accessi',exact:true}).click();
  await expect(page.getByText('GitHub',{exact:true})).toBeVisible();
  await expect(page.getByText('Da collegare',{exact:true})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'Apri Erbario di Gian'}).click();
  await expect(page.getByText('Il catalogo è pronto per una prima verifica.')).toBeVisible();
});

test('senza gateway la richiesta resta salvata e può essere riprovata', async ({page}) => {
  await page.route('http://127.0.0.1:8787/**', route => route.abort());
  await page.goto('/');
  await page.getByRole('button',{name:'Crea un progetto'}).click();
  await page.getByLabel('Nome della tua app').fill('Erbario');
  await expect(page.getByRole('button',{name:'Avvia la chat'})).toBeDisabled();
  await page.getByLabel('Descrivi la tua idea').fill('Catalogo di piante.');
  await page.getByRole('button',{name:'Avvia la chat'}).click();
  await expect(page.getByRole('button',{name:'Riprova con l’AI'})).toBeVisible();
  await expect(page.getByText('Catalogo di piante.',{exact:true})).toBeVisible();
});

test('riapre l’ultima conversazione integra dopo un salvataggio danneggiato', async ({page}) => {
  await page.route('http://127.0.0.1:8787/**', route => route.abort());
  await page.goto('/');
  for (const name of ['Erbario', 'Orto']) {
    await page.getByRole('button', {name: 'Crea un progetto'}).click();
    await page.getByLabel('Nome della tua app').fill(name);
    await page.getByLabel('Descrivi la tua idea').fill('Catalogo di piante.');
    await page.getByRole('button', {name: 'Avvia la chat'}).click();
    await expect(page.getByRole('button', {name: 'Riprova con l’AI'})).toBeVisible();
    await page.getByRole('button', {name: 'Progetti', exact: true}).click();
  }
  await page.evaluate(() => localStorage.setItem('forgia.conversations.v1', '{'));
  await page.reload();
  await expect(page.getByText('Ultimo salvataggio integro recuperato.')).toBeVisible();
  await page.getByRole('button', {name: 'Apri Erbario'}).click();
  await expect(page.getByText('Catalogo di piante.', {exact: true})).toBeVisible();
});

test('riprende una ricevuta dopo reload senza ripetere POST', async ({page}) => {
  let posts=0, available=false;
  const receipt='00112233-4455-6677-8899-aabbccddeeff';
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,idempotency-key','access-control-allow-methods':'GET,POST,OPTIONS'};
  await page.route('http://127.0.0.1:8787/**', async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(req.method()==='OPTIONS') return route.fulfill({status:204,headers});
    if(path==='/providers') return route.fulfill({headers,json:{providers:[{id:'local',model:'test',configured:true}]}});
    if(path==='/jobs' && req.method()==='POST'){
      posts++;expect(req.headers()['idempotency-key']).toBeTruthy();
      return route.fulfill({status:202,headers,json:{id:receipt}});
    }
    expect(path).toBe('/jobs/'+receipt);
    if(!available)return route.abort();
    return route.fulfill({headers,json:{status:'done',result:{spec:{name:'Orto',idea:'Risultato recuperato.',kind:'catalog',quiz:false,items:[{name:'Salvia',category:'Piante',color:''}]}}}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Crea un progetto'}).click();
  await page.getByLabel('Nome della tua app').fill('Orto');
  await page.getByLabel('Descrivi la tua idea').fill('Catalogo di piante.');
  await page.getByRole('button',{name:'Avvia la chat'}).click();
  await expect(page.getByRole('button',{name:'Riprendi lavoro AI'})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'Apri Orto'}).click();
  available=true;
  await page.getByRole('button',{name:'Riprendi lavoro AI'}).click();
  await expect(page.getByText('Risultato recuperato.')).toBeVisible();
  expect(posts).toBe(1);
});

test('UW3 protected web receipt resumes with re-entered credentials, without another POST', async ({page})=>{
 const account='00112233-4455-6677-8899-aabbccddeeff', code='a'.repeat(64), receipt='abcdef01-2345-6789-abcd-ef0123456789';
 let posts=0,available=false;
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,idempotency-key,authorization,x-forgia-require-auth,x-forgia-session','access-control-allow-methods':'GET,POST,OPTIONS'};
 await page.route('http://127.0.0.1:8787/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  expect(req.headers()['authorization']).toBe('Bearer '+code);
  expect(req.headers()['x-forgia-require-auth']).toBe('1');
  if(path==='/providers')return route.fulfill({headers,json:{durableAuthorizationRequired:true,durableSession:account,providers:[{id:'local',model:'test',configured:true}]}});
  if(path==='/jobs' && req.method()==='POST'){
   posts++;expect(req.postDataJSON().session).toBe(account);expect(req.postDataJSON().cloudConsent).toBe(false);
   return route.fulfill({status:202,headers,json:{id:receipt}});
  }
  expect(path).toBe('/jobs/'+receipt);
  if(!available)return route.abort();
  return route.fulfill({headers,json:{status:'done',result:{spec:{name:'Orto',idea:'Risultato protetto recuperato.',kind:'catalog',quiz:false,items:[{name:'Salvia',category:'Piante',color:''}]}}}});
 });
 async function enter(){
  await page.getByRole('button',{name:'Motori AI',exact:true}).click();
  await page.getByLabel('UUID account locale').fill(account);
  await page.getByLabel('Codice locale',{exact:true}).fill(code);
  await page.getByRole('button',{name:'Progetti',exact:true}).click();
 }
 await page.goto('/');await enter();
 await page.getByRole('button',{name:'Crea un progetto'}).click();
 await page.getByLabel('Nome della tua app').fill('Orto');
 await page.getByLabel('Descrivi la tua idea').fill('Catalogo di piante.');
 await page.getByRole('button',{name:'Avvia la chat'}).click();
 await expect(page.getByRole('button',{name:'Riprendi lavoro AI'})).toBeVisible();
 const stored=await page.evaluate(()=>JSON.stringify({...localStorage}));
 expect(stored).not.toContain(code);expect(stored).toContain('protectedLocal');
 await page.reload();
 await page.getByRole('button',{name:'Apri Orto'}).click();
 await page.getByRole('button',{name:'Riprendi lavoro AI'}).click();
 await expect(page.getByText('Ripristina le autorizzazioni originali della ricevuta. Nessun reinvio.')).toBeVisible();
 available=true;await enter();
 await page.getByRole('button',{name:'Apri Orto'}).click();
 await page.getByRole('button',{name:'Riprendi lavoro AI'}).click();
 await expect(page.getByText('Risultato protetto recuperato.')).toBeVisible();
 expect(posts).toBe(1);
});
