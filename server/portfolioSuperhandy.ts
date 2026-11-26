import {importPortfolioPlan} from './masterPortfolioOrchestrator.ts';
import {validateBaseline} from './superhandyLedger.ts';

// Intake only: never turns a portfolio milestone into an executable command.
// All three tasks require operator-supplied evidence and review in the ledger.
export function portfolioSuperhandyBaseline(source: string, projectId: string, roles: {
  planner: string; reviewer: string; executors: string[];
}) {
  if (Buffer.byteLength(source) > 1024 * 1024) throw Error('Piano portafoglio troppo grande.');
  const {projects, sourceSha256} = importPortfolioPlan(source);
  const project = projects.find(p => p.id === projectId);
  if (!project || project.status !== 'reconcile') throw Error('Progetto non disponibile per la riconciliazione.');
  const repository = project.repository;
  if (!repository || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repository) || repository.split('/').slice(-2).some(p => p === '.' || p === '..')) {
    throw Error('Repository da verificare prima della presa in carico.');
  }
  const repoLines = project.sourceSection.split('\n').filter(line => /^Repository(?: principale)?:/.test(line));
  const exactLine = repoLines[0]?.replace(/^Repository(?: principale)?:\s*/, '').trim();
  if (repoLines.length !== 1 || (exactLine !== repository && exactLine !== `[${repository}](${repository})`)) {
    throw Error('Riferimento repository ambiguo: riconciliazione manuale richiesta.');
  }
  const context = `Portafoglio SHA-256 ${sourceSha256}; progetto ${project.id}; repository ${repository}. Sola lettura, budget zero.`;
  return validateBaseline({
    project: project.id, planner: roles.planner, reviewer: roles.reviewer, executors: roles.executors,
    tasks: [
      {id:'portfolio-inventory', depends:[], criterion:`${context} Recuperare i piani e handoff originali della sezione esatta, registrare SHA, branch, PR aperte e assegnazioni effettive. Se assegnazione concorrente, sospendere; non modificare alcun repository.`},
      {id:'portfolio-requirements', depends:['portfolio-inventory'], criterion:`${context} Confrontare tutti i requisiti originali con il codice della baseline verificata. Conservare ID, dipendenze, milestone e scostamenti; indicare informazioni mancanti senza inventarle.`},
      {id:'portfolio-evidence', depends:['portfolio-requirements'], criterion:`${context} Mappare implementazione, test, build firmate, beta, produzione e commercializzazione alle rispettive evidenze; produrre backlog riconciliato e blocchi. Nessuna promozione di stato o autorizzazione allo sviluppo automatico.`},
    ],
  });
}
