/**
 * Les modifications qu'un assistant peut proposer sur un scénario Make.
 *
 * Volontairement limitées aux modules qui EXISTENT : on retouche la
 * configuration d'un module, son filtre, son nom, ou on le retire. Ajouter un
 * module demanderait de connaître la description d'un module que le scénario
 * n'emploie pas encore — Make l'embarque dans le blueprint pour ceux qui y sont,
 * et ne la sert nulle part ailleurs sans son serveur MCP. Écrire ces réglages de
 * mémoire, dans le scénario d'un client, c'est exactement ce que la porte doit
 * empêcher.
 *
 * Tout désigne un module par son id : c'est aussi ce que font les expressions
 * (`{{2.email}}`), et deux modules sans nom d'un même type portent le même
 * libellé.
 */
import { MakeBlueprint, MakeFilter, MakeModule, flattenModules, isMakeBlueprint } from './blueprint';

export type MakeEditOperation =
  | { type: 'set-module-mapper'; moduleId: number; mapper: Record<string, unknown> }
  | { type: 'set-module-parameters'; moduleId: number; parameters: Record<string, unknown> }
  | { type: 'remove-module-field'; moduleId: number; section: 'mapper' | 'parameters'; path: string }
  | { type: 'set-module-filter'; moduleId: number; filter: MakeFilter | null }
  | { type: 'rename-module'; moduleId: number; name: string }
  | { type: 'remove-module'; moduleId: number };

export const MAKE_EDIT_OPERATION_TYPES: ReadonlyArray<MakeEditOperation['type']> = [
  'set-module-mapper',
  'set-module-parameters',
  'remove-module-field',
  'set-module-filter',
  'rename-module',
  'remove-module',
];

/** Une opération inapplicable. Son message repart tel quel vers le modèle. */
export class BlueprintEditError extends Error {}

/**
 * Les clés par lesquelles Make lie un module au COMPTE : connexion, webhook,
 * clé, data store. Leur valeur est un id qui ne vaut que dans ce compte, et que
 * l'assistant ne peut pas connaître — changer de connexion se fait dans Make.
 */
const ACCOUNT_KEY = /^__IMT[A-Z]+__$/;

/** Ce que `redactSecrets` pose à la place d'un secret : le recopier écrirait le masque dans Make. */
const SECRET_MASK = '[secret masqué';

/**
 * Applique les opérations à une COPIE du blueprint. Une seule opération fautive
 * fait tout refuser : un scénario retouché à moitié est pire qu'intact.
 */
export function applyBlueprintEdits(
  blueprint: unknown,
  operations: unknown[],
): { blueprint: MakeBlueprint; warnings: string[] } {
  if (!isMakeBlueprint(blueprint)) {
    throw new BlueprintEditError(
      "Contenu illisible comme blueprint Make (aucun 'flow') : rien n'est modifié.",
    );
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new BlueprintEditError('Aucune opération à appliquer.');
  }
  const copy = structuredClone(blueprint);
  const warnings: string[] = [];
  operations.forEach((raw, index) => {
    const operation = readOperation(raw, index);
    const warning = applyOne(copy, operation);
    if (warning) warnings.push(warning);
  });
  return { blueprint: copy, warnings };
}

/** Une ligne par geste, pour nommer une proposition dont le modèle n'a pas donné le résumé. */
export function summarizeMakeOperations(operations: MakeEditOperation[]): string {
  const modules = (types: Array<MakeEditOperation['type']>) =>
    new Set(operations.filter((op) => types.includes(op.type)).map((op) => op.moduleId)).size;
  const parts = [
    [
      modules(['set-module-mapper', 'set-module-parameters', 'remove-module-field', 'set-module-filter']),
      'modifié',
    ],
    [modules(['rename-module']), 'renommé'],
    [modules(['remove-module']), 'supprimé'],
  ] as const;
  const said = parts
    .filter(([count]) => count > 0)
    .map(([count, verb]) => `${count} module${count > 1 ? 's' : ''} ${verb}${count > 1 ? 's' : ''}`);
  return said.length > 0 ? `Scénario : ${said.join(', ')}` : 'Modification proposée';
}

function readOperation(raw: unknown, index: number): MakeEditOperation {
  const op = raw as Partial<MakeEditOperation> & Record<string, unknown>;
  const where = `opération ${index + 1}`;
  if (!op || typeof op !== 'object' || typeof op.type !== 'string') {
    throw new BlueprintEditError(`${where} : sans « type ».`);
  }
  if (!MAKE_EDIT_OPERATION_TYPES.includes(op.type as MakeEditOperation['type'])) {
    throw new BlueprintEditError(
      `${where} : « ${op.type} » n'existe pas sur un scénario Make. Opérations possibles : ` +
        `${MAKE_EDIT_OPERATION_TYPES.join(', ')}. Ajouter un module ou une route n'est pas possible ici.`,
    );
  }
  if (typeof op.moduleId !== 'number' || !Number.isInteger(op.moduleId)) {
    throw new BlueprintEditError(`${where} (${op.type}) : « moduleId » doit être l'id entier du module.`);
  }
  switch (op.type) {
    case 'set-module-mapper':
      assertPatch(op.mapper, `${where} (${op.type}) : « mapper »`);
      break;
    case 'set-module-parameters':
      assertPatch(op.parameters, `${where} (${op.type}) : « parameters »`);
      break;
    case 'remove-module-field':
      if (op.section !== 'mapper' && op.section !== 'parameters') {
        throw new BlueprintEditError(`${where} (${op.type}) : « section » vaut "mapper" ou "parameters".`);
      }
      if (typeof op.path !== 'string' || !op.path.trim()) {
        throw new BlueprintEditError(`${where} (${op.type}) : « path » manquant (ex. "headers.0.value").`);
      }
      if (op.path.split('.').some((segment) => ACCOUNT_KEY.test(segment))) {
        throw new BlueprintEditError(accountKeyRefusal(`${where} (${op.type})`));
      }
      break;
    case 'set-module-filter':
      if (op.filter !== null && (typeof op.filter !== 'object' || Array.isArray(op.filter))) {
        throw new BlueprintEditError(
          `${where} (${op.type}) : « filter » est un objet, ou null pour le retirer.`,
        );
      }
      if (op.filter) assertNoMask(op.filter, `${where} (${op.type})`);
      break;
    case 'rename-module':
      if (typeof op.name !== 'string' || !op.name.trim()) {
        throw new BlueprintEditError(`${where} (${op.type}) : « name » vide.`);
      }
      break;
  }
  return op as MakeEditOperation;
}

function applyOne(blueprint: MakeBlueprint, op: MakeEditOperation): string | null {
  if (op.type === 'remove-module') return removeModule(blueprint, op.moduleId);

  const module = findModule(blueprint, op.moduleId);
  switch (op.type) {
    case 'set-module-mapper':
      module.mapper = deepMerge(module.mapper ?? {}, op.mapper);
      return null;
    case 'set-module-parameters':
      module.parameters = deepMerge(module.parameters ?? {}, op.parameters);
      return null;
    case 'remove-module-field':
      return removeField(module, op.section, op.path);
    case 'set-module-filter':
      if (op.filter === null) {
        delete module.filter;
        return `Le filtre du module #${op.moduleId} est retiré : il laissera passer tous les bundles.`;
      }
      module.filter = op.filter;
      return null;
    case 'rename-module':
      module.metadata = {
        ...module.metadata,
        designer: { ...module.metadata?.designer, name: op.name.trim() },
      };
      return null;
  }
}

function findModule(blueprint: MakeBlueprint, moduleId: number): MakeModule {
  const found = flattenModules(blueprint).find((flat) => flat.module.id === moduleId);
  if (!found) throw new BlueprintEditError(`Module #${moduleId} introuvable dans ce scénario.`);
  return found.module;
}

/** Retire le module de SON flow, avec ce qu'il porte : routes, branches, gestionnaires. */
function removeModule(blueprint: MakeBlueprint, moduleId: number): string | null {
  const nested = (module: MakeModule): number => flattenModules({ flow: [module] }).length - 1;

  const visit = (flow: MakeModule[] | undefined): string | null | undefined => {
    if (!flow) return undefined;
    const index = flow.findIndex((module) => module?.id === moduleId);
    if (index >= 0) {
      const [removed] = flow.splice(index, 1);
      const carried = nested(removed);
      return carried > 0
        ? `Supprimer le module #${moduleId} retire aussi les ${carried} module(s) qu'il porte (routes, branches, gestionnaires).`
        : null;
    }
    for (const module of flow) {
      for (const child of [
        ...(module.routes ?? []).map((route) => route.flow),
        ...(module.branches ?? []).map((branch) => branch.flow),
        module.onerror,
      ]) {
        const result = visit(child);
        if (result !== undefined) return result;
      }
    }
    return undefined;
  };

  const result = visit(blueprint.flow);
  if (result === undefined) throw new BlueprintEditError(`Module #${moduleId} introuvable dans ce scénario.`);
  return result;
}

function removeField(module: MakeModule, section: 'mapper' | 'parameters', path: string): string | null {
  const segments = path.split('.');
  let cursor: unknown = module[section];
  for (const segment of segments.slice(0, -1)) {
    cursor = (cursor as Record<string, unknown> | undefined)?.[segment];
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(cursor) && /^\d+$/.test(last) && Number(last) < cursor.length) {
    cursor.splice(Number(last), 1);
    return null;
  }
  if (cursor && typeof cursor === 'object' && last in (cursor as object)) {
    delete (cursor as Record<string, unknown>)[last];
    return null;
  }
  return `« ${section}.${path} » était déjà absent du module #${module.id}.`;
}

/** Fusion en profondeur : un objet se complète, un tableau ou une valeur se remplace. */
function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const previous = out[key];
    out[key] = isPlainObject(previous) && isPlainObject(value) ? deepMerge(previous, value) : value;
  }
  return out;
}

function assertPatch(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    throw new BlueprintEditError(`${label} doit être un objet non vide — seules les clés données changent.`);
  }
  if (hasAccountKey(value)) throw new BlueprintEditError(accountKeyRefusal(label));
  assertNoMask(value, label);
}

function assertNoMask(value: unknown, label: string): void {
  if (JSON.stringify(value).includes(SECRET_MASK)) {
    throw new BlueprintEditError(
      `${label} : une valeur masquée (« [secret masqué …] ») a été recopiée. Le vrai secret n'est jamais ` +
        `montré : ne réécris pas ce champ, laisse-le tel quel en ne le mettant pas dans l'opération.`,
    );
  }
}

function hasAccountKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasAccountKey);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, child]) => ACCOUNT_KEY.test(key) || hasAccountKey(child));
}

function accountKeyRefusal(label: string): string {
  return (
    `${label} : les clés « __IMT…__ » (connexion, webhook, clé du compte) ne se modifient pas ici — ` +
    `leur valeur est un id propre au compte Make. Dis à l'utilisateur de la choisir dans Make.`
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
