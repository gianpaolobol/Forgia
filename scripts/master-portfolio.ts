import {readFile} from 'node:fs/promises';
import {importPortfolioPlan, planPortfolio, portfolioHandoff} from '../server/masterPortfolioOrchestrator.ts';
import {openRouterCatalog, openRouterKeyStatus, requestedFamilies} from '../server/openRouterCatalog.ts';

async function main() {
  const [command, path, projectId, ...extra] = process.argv.slice(2);
  const usage = 'Uso: portfolio plan <piano.md> | portfolio handoff <piano.md> <progetto> | portfolio models | portfolio key | portfolio superhandy <piano.md> <progetto> <planner> <reviewer> <executor...>';
  if (command === 'superhandy') {
    const [planner, reviewer, ...executors] = extra;
    if (!path || !projectId || !planner || !reviewer || !executors.length) throw Error(usage);
    const {portfolioSuperhandyBaseline} = await import('../server/portfolioSuperhandy.ts');
    return portfolioSuperhandyBaseline(await readFile(path, 'utf8'), projectId, {planner, reviewer, executors});
  }
  if (extra.length) throw Error(usage);

  switch (command) {
    case 'plan':
    case 'handoff': {
      if (!path || (command === 'handoff' ? !projectId : projectId !== undefined)) throw Error(usage);
      const {projects, ...baseline} = importPortfolioPlan(await readFile(path, 'utf8'));
      if (command === 'plan') return {...baseline, projects: planPortfolio(projects)};
      const project = projects.find(item => item.id === projectId);
      if (!project) throw Error('Progetto assente dal piano.');
      return portfolioHandoff(project, baseline.sourceSha256);
    }
    case 'models': {
      if (path) throw Error(usage);
      const models = await openRouterCatalog();
      const families = [...new Set([...requestedFamilies, ...models.map(model => model.family)])];
      return Object.fromEntries(families.map(family => [family, models.filter(model => model.family === family)]));
    }
    case 'key':
      if (path) throw Error(usage);
      return openRouterKeyStatus(process.env.OPENROUTER_API_KEY ?? '').catch(() => {
        throw Error('Verifica chiave OpenRouter fallita. Controllare OPENROUTER_API_KEY locale e la connessione.');
      });
    default:
      throw Error(usage);
  }
}

try {
  console.log(JSON.stringify(await main(), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Operazione non riuscita.');
  process.exitCode = 1;
}
