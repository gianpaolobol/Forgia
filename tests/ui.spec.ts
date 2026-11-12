import {test, expect} from '@playwright/test';

test('dall’idea alla chat, al risultato AI e agli accessi per progetto', async ({page}) => {
  await page.route('http://127.0.0.1:8787/**', async route => {
    const headers = {'access-control-allow-origin':'*', 'access-control-allow-headers':'content-type',
      'access-control-allow-methods':'GET, POST, OPTIONS'};
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    const path = new URL(route.request().url()).pathname;
    if (path === '/providers') return route.fulfill({headers, json: {providers:[{id:'llamacpp', model:'Qwen test', configured:true}]}});
    if (path === '/jobs') return route.fulfill({status: 202, headers, json:{id:'job-test'}});
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
