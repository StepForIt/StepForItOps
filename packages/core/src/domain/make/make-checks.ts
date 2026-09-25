/**
 * Ce qu'on sait vérifier sur un blueprint Make sans IA ni IO.
 *
 * Le pendant de `runWorkflowChecks` côté n8n : même type de finding, même usage
 * — l'analyse du module `verifier` d'un côté, la relecture de l'assistant de
 * l'autre, sur la MÊME liste, sinon l'un validerait sur des règles que l'autre
 * ignore.
 *
 * Le parti pris est celui qu'a imposé la mesure côté n8n : mieux vaut se taire
 * que crier à tort. Chaque règle ci-dessous ne se déclenche que sur une faute
 * qui a une conséquence nommable à l'exécution.
 */
import { CheckFinding } from '../check-finding';
import { MIN_SECRET_LENGTH, SECRET_VALUE_PATTERNS, isExpression, isPlaceholder } from '../secret-patterns';
import { FlatModule, MakeBlueprint, flattenModules, moduleLabel, moduleStrings } from './blueprint';
import { referencedModuleIds } from './make-expressions';
import { runMakeSchemaChecks } from './make-schema';

/** Les itérateurs connus : ce à quoi un agrégateur a le droit de se rattacher. */
const FEEDERS = new Set(['builtin:BasicFeeder', 'builtin:BasicIterator']);
const AGGREGATORS = new Set([
  'builtin:BasicAggregator',
  'util:TextAggregator',
  'array:ArrayAggregator',
  'json:CreateJSON',
]);

export function runMakeChecks(blueprint: MakeBlueprint): CheckFinding[] {
  const modules = flattenModules(blueprint);
  return [
    ...checkReferences(modules),
    ...checkAggregatorFeeder(modules),
    ...checkIfElseMerge(blueprint),
    ...checkSecrets(modules),
    // Conformité de chaque module à son propre schéma, que Make embarque dans le
    // blueprint (`metadata.expect` / `metadata.parameters`).
    ...runMakeSchemaChecks(modules),
  ];
}

/**
 * Une expression `{{4.email}}` qui vise un module inexistant, ou un module qui
 * n'aura PAS tourné quand celui-ci s'exécute.
 *
 * Chez Make, l'imbrication porte déjà l'atteignabilité : une route ne voit pas
 * sa sœur, une branche d'If/Else non plus. Pas besoin de rejouer un graphe.
 */
function checkReferences(modules: FlatModule[]): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const known = new Set(modules.map((m) => m.module.id));

  for (const flat of modules) {
    const upstream = new Set(flat.upstreamIds);
    for (const id of referencedModuleIds(moduleStrings(flat.module))) {
      if (id === flat.module.id) continue;
      if (!known.has(id)) {
        findings.push({
          severity: 'error',
          code: 'make-ref-unknown',
          message: `« ${moduleLabel(flat.module)} » lit la sortie du module ${id}, qui n'existe pas dans ce scénario.`,
          nodeName: moduleLabel(flat.module),
          data: { referencedId: id },
        });
        continue;
      }
      if (!upstream.has(id)) {
        findings.push({
          severity: 'warning',
          code: 'make-ref-unreachable',
          message:
            `« ${moduleLabel(flat.module)} » lit la sortie du module ${id}, qui n'aura pas tourné : ` +
            `il est ailleurs dans le scénario (autre route, autre branche, ou plus loin).`,
          nodeName: moduleLabel(flat.module),
          data: { referencedId: id },
        });
      }
    }
  }
  return findings;
}

/**
 * Un agrégateur sans source, ou branché sur un module qui n'itère rien.
 *
 * `feeder` va dans `parameters` et non à la racine du module : posé au mauvais
 * endroit, il est ignoré à l'exécution — le scénario s'importe, l'éditeur ne dit
 * rien, et l'agrégation ne se fait pas. C'est le pendant Make du câblage de
 * boucle inversé côté n8n, et il est aussi silencieux.
 */
function checkAggregatorFeeder(modules: FlatModule[]): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const byId = new Map(modules.map((m) => [m.module.id, m.module]));

  for (const flat of modules) {
    const type = flat.module.module ?? '';
    if (!AGGREGATORS.has(type)) continue;

    const feeder = flat.module.parameters?.feeder;
    if (feeder === undefined || feeder === null) {
      const misplaced = (flat.module as unknown as { feeder?: unknown }).feeder;
      findings.push({
        severity: 'error',
        code: 'make-aggregator-no-feeder',
        message:
          misplaced === undefined
            ? `« ${moduleLabel(flat.module)} » agrège sans source : \`feeder\` manque dans \`parameters\`.`
            : `« ${moduleLabel(flat.module)} » porte \`feeder\` à la racine du module au lieu de \`parameters\` : ` +
              `Make l'ignore, et l'agrégation ne se fait pas.`,
        nodeName: moduleLabel(flat.module),
      });
      continue;
    }

    const source = byId.get(Number(feeder));
    if (!source) {
      findings.push({
        severity: 'error',
        code: 'make-aggregator-no-feeder',
        message: `« ${moduleLabel(flat.module)} » agrège la sortie du module ${feeder}, qui n'existe pas.`,
        nodeName: moduleLabel(flat.module),
        data: { feeder },
      });
      continue;
    }
    if (!FEEDERS.has(source.module ?? '')) {
      findings.push({
        severity: 'warning',
        code: 'make-aggregator-bad-feeder',
        message:
          `« ${moduleLabel(flat.module)} » agrège « ${moduleLabel(source)} », qui n'itère rien : ` +
          `un agrégateur se rattache à l'itérateur qui a découpé les bundles.`,
        nodeName: moduleLabel(flat.module),
        data: { feeder },
      });
    }
  }
  return findings;
}

/**
 * Un If/Else doit être IMMÉDIATEMENT suivi de son Merge, et le Merge doit porter
 * autant de filtres que l'If/Else a de branches.
 *
 * Sans le Merge, les branches ne se rejoignent pas et tout ce qui suit ne
 * s'exécute jamais — sur un scénario qui s'importe et paraît vert. Un décompte
 * de filtres qui ne colle pas fait retomber la mauvaise branche.
 */
function checkIfElseMerge(blueprint: MakeBlueprint): CheckFinding[] {
  const findings: CheckFinding[] = [];

  const inspect = (flow: import('./blueprint').MakeModule[] | undefined): void => {
    const modules = flow ?? [];
    modules.forEach((module, index) => {
      for (const route of module.routes ?? []) inspect(route.flow);
      for (const branch of module.branches ?? []) inspect(branch.flow);

      if (module.module !== 'builtin:BasicIfElse') return;
      const next = modules[index + 1];
      if (next?.module !== 'builtin:BasicMerge') {
        findings.push({
          severity: 'error',
          code: 'make-ifelse-without-merge',
          message:
            `« ${moduleLabel(module)} » n'est pas suivi d'un Merge : les branches ne se rejoignent pas, ` +
            `et rien de ce qui vient après ne s'exécutera.`,
          nodeName: moduleLabel(module),
        });
        return;
      }
      const branches = (module.branches ?? []).length;
      const filters = (next.parameters?.filters as unknown[] | undefined)?.length;
      if (branches > 0 && filters !== undefined && filters !== branches) {
        findings.push({
          severity: 'error',
          code: 'make-merge-filters-mismatch',
          message:
            `« ${moduleLabel(next)} » déclare ${filters} filtre(s) pour ${branches} branche(s) : ` +
            `le rapprochement se décale, et la mauvaise branche retombe.`,
          nodeName: moduleLabel(next),
          data: { branches, filters },
        });
      }
    });
  };

  inspect(blueprint.flow);
  return findings;
}

/**
 * Un secret écrit en clair dans les paramètres, plutôt que dans une connexion.
 *
 * Mêmes motifs que côté n8n, et les mêmes garde-fous : une valeur qui porte une
 * expression ne contient pas le secret, et un gabarit visible (`YOUR_API_KEY`,
 * `<token>`) est un oubli de configuration, pas une fuite — il a son propre
 * finding, plus juste et moins alarmant.
 */
function checkSecrets(modules: FlatModule[]): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const flat of modules) {
    const values = moduleStrings(flat.module);

    if (values.some((value) => !isExpression(value) && isPlaceholder(value) && value.length >= 6)) {
      findings.push({
        severity: 'warning',
        code: 'make-placeholder',
        message:
          `« ${moduleLabel(flat.module)} » porte encore une valeur d'exemple : ` +
          `elle n'échouera qu'à la première exécution réelle.`,
        nodeName: moduleLabel(flat.module),
      });
    }

    const leaked = values.some(
      (value) =>
        !isExpression(value) &&
        !isPlaceholder(value) &&
        value.length >= MIN_SECRET_LENGTH &&
        SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value)),
    );
    if (leaked) {
      findings.push({
        severity: 'warning',
        code: 'make-secret-in-clear',
        message:
          `« ${moduleLabel(flat.module)} » porte ce qui ressemble à un secret en clair : ` +
          `une connexion Make le garde hors du blueprint, qui s'exporte et se partage.`,
        nodeName: moduleLabel(flat.module),
      });
    }
  }
  return findings;
}
