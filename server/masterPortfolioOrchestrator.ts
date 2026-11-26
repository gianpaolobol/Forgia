import {createHash} from 'node:crypto';

export const deliveryStages = ['implementation', 'tests', 'signedBuild', 'beta',
  'production', 'commercialization'] as const;
type Stage = typeof deliveryStages[number];
export type PortfolioEvidence = {stage: Stage; ref: string};
export type PortfolioProject = {
  id: string;
  name: string;
  repository: string | null;
  priority: number | null;
  status: 'reconcile' | 'external' | 'paused' | 'excluded';
  sourceSection: string;
  originalReferences: string[];
  milestones: string[];
  evidence: PortfolioEvidence[];
};

export function importPortfolioPlan(source: string) {
  const normalized = source.replace(/\r\n/g, '\n');
  const sections = [...normalized.matchAll(/^## (\d+)\. (.+)$/gm)];
  if (sections.length < 2 || sections[0][1] !== '0' ||
      sections.some((section, index) => Number(section[1]) !== index)) {
    throw Error('Il piano deve avere sezioni numerate consecutive a partire da 0.');
  }

  const projects: PortfolioProject[] = [];
  const policies: {name: string; sourceSection: string}[] = [];
  for (const [index, section] of sections.entries()) {
    const [, number, name] = section;
    const sourceSection = normalized.slice(section.index, sections[index + 1]?.index).trim();
    if (index === 0 || /^REPOSITORY AUSILIARIE$|^PIANIFICAZIONE ESECUTIVA/i.test(name)) {
      policies.push({name, sourceSection});
      continue;
    }
    const priorityLine = sourceSection.match(/^\*\*Priorità: .+$/m)?.[0] ?? '';
    const priority = priorityLine.match(/Priorità: P([0-3])\b/);
    const repository = sourceSection.match(/^Repository(?: principale)?:\s*\[?(https:\/\/github\.com\/[\w.-]+\/[\w.-]+)/m)?.[1] ?? null;
    const status = /temporaneamente sospesa/i.test(priorityLine) ? 'paused'
      : /^Non modificare contemporaneamente il branch assegnato\./m.test(sourceSection) ? 'external' : 'reconcile';
    const milestones = [...sourceSection.matchAll(/^\d+\. (.+)$/gm)].map(match => match[1]);
    const originalReferences = [...new Set([...sourceSection.matchAll(/(?:docs\/)?[\w][\w./-]*\.md\b/g)].map(match => match[0]))];
    projects.push({
      id: `portfolio-${number.padStart(2, '0')}`, name, repository,
      priority: priority ? Number(priority[1]) : null, status, milestones,
      originalReferences, sourceSection, evidence: [],
    });
  }
  if (!projects.length) throw Error('Nessun progetto nel piano.');
  return {
    schemaVersion: 1,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    projects,
    policies,
  };
}

/** Reconciliation is the next task until each product's actual GitHub baseline is known. */
export function planPortfolio(projects: readonly PortfolioProject[]) {
  return [...projects].sort((a, b) =>
    (a.priority ?? Infinity) - (b.priority ?? Infinity) || a.id.localeCompare(b.id),
  ).map(project => ({
    ...project,
    budgetUsd: 0,
    baseline: {version: null, sha: null, branch: null, openPullRequests: null, owner: null, ai: null},
    backlog: project.milestones.map((title, index) => ({
      id: `${project.id}-${String(index + 1).padStart(2, '0')}`,
      title,
      status: 'pending-reconciliation',
    })),
    delivery: Object.fromEntries(deliveryStages.map(stage => [
      stage, project.evidence.filter(item => item.stage === stage).map(item => item.ref),
    ])),
    nextAction: {
      external: 'Leggere le evidenze dal ramo assegnato e coordinarsi con il referente.',
      paused: 'Attendere la decisione di riattivazione.',
      excluded: 'Tenere fuori dalla coda di sviluppo.',
      reconcile: 'Recuperare specifiche originali, SHA, PR, test e distribuzioni prima di assegnare sviluppo.',
    }[project.status],
  }));
}

export const superhandyRoles = [
  'analyst', 'planner', 'independentReviewer', 'coordinator',
  'implementer', 'tester', 'finalValidator',
] as const;

/** A portable reconciliation handoff. It confers no write permissions. */
export function portfolioHandoff(project: PortfolioProject, sourceSha256: string) {
  const selected = planPortfolio([project])[0];
  const mayReconcile = project.status === 'reconcile' || project.status === 'external';
  return {
    projectId: project.id,
    sourceSha256,
    repository: project.repository,
    status: project.status,
    role: mayReconcile ? superhandyRoles[0] : null,
    scope: 'read-only',
    checklist: mayReconcile ? [
      'Leggere integralmente piani, PRD e handoff originali.',
      'Registrare ramo, SHA e PR esatti e confrontare i requisiti col codice.',
      'Collegare ciascun test, build e distribuzione alla sua evidenza.',
      'Conservare ID, dipendenze e gate storici nel backlog riconciliato.',
    ] : [],
    originalReferences: project.originalReferences,
    nextAction: selected.nextAction,
  };
}
