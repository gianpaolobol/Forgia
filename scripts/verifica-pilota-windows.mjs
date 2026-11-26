import {X509Certificate} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {get} from 'node:https';
import {setTimeout as pause} from 'node:timers/promises';

const [origin, caPath] = process.argv.slice(2);
const code = process.env.FORGIA_SMOKE_TEST_CODE;
const ca = new X509Certificate(await readFile(caPath)).toString();
function readProviders() {
  return new Promise((resolve, reject) => {
    const req = get(origin + '/providers', {ca, headers: {Authorization: 'Bearer ' + code}}, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', part => { body += part; });
      res.on('error', reject);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw Error('HTTPS ' + res.statusCode);
          resolve(JSON.parse(body));
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(Error('Timeout HTTPS')));
  });
}

for (let attempt = 0; ; attempt++) {
  try {
    const data = await readProviders();
    if (!data.providers?.some(provider => provider.id === 'local' && provider.configured)) {
      throw Error('Ollama non configurato');
    }
    break;
  } catch (error) {
    if (attempt >= 9) throw error;
    await pause(500);
  }
}
console.log('Verifica HTTPS e autenticazione riuscita.');
