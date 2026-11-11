import {test,expect} from '@playwright/test';
test('crea una bozza, esporta i sorgenti, itera e conserva cronologia dopo reload',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Crea un progetto'}).click();
 await page.getByLabel('Nome della tua app').fill('Erbario di Gian');
 await page.getByLabel('Descrivi la tua idea').fill('Voglio un catalogo offline per studiare le mie piante con ricerca e preferiti.');
 await page.getByRole('button',{name:'Usa dati di esempio'}).click();
 await page.getByRole('button',{name:'Salva prima bozza'}).click();
 await expect(page.getByText('Erbario di Gian',{exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'Esporta sorgenti ZIP'}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Scarica ZIP'}).click();expect((await download).suggestedFilename()).toMatch(/erbario-di-gian.*zip/);
 await page.getByRole('button',{name:'Modifica la bozza'}).click();
 await page.getByLabel('Nome della tua app').fill('Erbario libero');
 await page.getByLabel('Descrivi questa modifica').fill('Rinomina l’app e mantieni tutte le schede');
 await page.getByRole('button',{name:'Salva nuova versione'}).click();
 await expect(page.getByText('Erbario libero',{exact:true}).first()).toBeVisible();
 await page.reload();await page.getByRole('button',{name:/Apri Erbario libero/}).click();await expect(page.getByText('Rinomina l’app e mantieni tutte le schede',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Ripristina r1'}).click();await expect(page.getByText('Erbario di Gian',{exact:true}).first()).toBeVisible();
});
test('dataset incompleto non salva un falso progetto',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Crea un progetto'}).click();await page.getByLabel('Nome della tua app').fill('Vuota');await page.getByLabel('Descrivi la tua idea').fill('Catalogo senza dati');await page.getByRole('button',{name:'Salva prima bozza'}).click();await expect(page.getByRole('alert')).toContainText('schede');
});
test('mobile: nessuna spesa e nessuna connessione simulata',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'Motori AI',exact:true}).click();await expect(page.getByText('Nessun motore AI collegato',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Accessi',exact:true}).click();await expect(page.getByText('Nessun account collegato',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
