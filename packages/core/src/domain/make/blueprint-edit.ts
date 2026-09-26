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
import { msg } from '../../i18n';
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

/**
 * Ce que `redactSecrets` pose à la place d'un secret : le recopier écrirait le masque dans Make.
 * Marqueur figé, jamais traduit — c'est une comparaison de texte.
 */
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
    throw new BlueprintEditError(msg('edit.makeUnreadable'));
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new BlueprintEditError(msg('edit.makeNoOperations'));
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
      'edit.makeSummaryModified',
    ],
    [modules(['rename-module']), 'edit.makeSummaryRenamed'],
    [modules(['remove-module']), 'edit.makeSummaryRemoved'],
  ] as const;
  const said = parts.filter(([count]) => count > 0).map(([count, id]) => msg(id, { count }));
  return said.length > 0 ? msg('edit.makeSummary', { parts: said.join(', ') }) : msg('edit.summaryDefault');
}

function readOperation(raw: unknown, index: number): MakeEditOperation {
  const op = raw as Partial<MakeEditOperation> & Record<string, unknown>;
  const where = msg('edit.makeOpWhere', { index: index + 1 });
  const whereType = () => msg('edit.makeOpWhereType', { index: index + 1, type: String(op.type) });
  if (!op || typeof op !== 'object' || typeof op.type !== 'string') {
    throw new BlueprintEditError(msg('edit.makeOpNoType', { where }));
  }
  if (!MAKE_EDIT_OPERATION_TYPES.includes(op.type as MakeEditOperation['type'])) {
    throw new BlueprintEditError(
      msg('edit.makeOpUnknownType', { where, type: op.type, types: MAKE_EDIT_OPERATION_TYPES.join(', ') }),
    );
  }
  if (typeof op.moduleId !== 'number' || !Number.isInteger(op.moduleId)) {
    throw new BlueprintEditError(msg('edit.makeOpModuleId', { where: whereType() }));
  }
  switch (op.type) {
    case 'set-module-mapper':
      assertPatch(op.mapper, msg('edit.makeOpField', { where: whereType(), field: 'mapper' }));
      break;
    case 'set-module-parameters':
      assertPatch(op.parameters, msg('edit.makeOpField', { where: whereType(), field: 'parameters' }));
      break;
    case 'remove-module-field':
      if (op.section !== 'mapper' && op.section !== 'parameters') {
        throw new BlueprintEditError(msg('edit.makeOpSection', { where: whereType() }));
      }
      if (typeof op.path !== 'string' || !op.path.trim()) {
        throw new BlueprintEditError(msg('edit.makeOpPath', { where: whereType() }));
      }
      if (op.path.split('.').some((segment) => ACCOUNT_KEY.test(segment))) {
        throw new BlueprintEditError(accountKeyRefusal(whereType()));
      }
      break;
    case 'set-module-filter':
      if (op.filter !== null && (typeof op.filter !== 'object' || Array.isArray(op.filter))) {
        throw new BlueprintEditError(msg('edit.makeOpFilter', { where: whereType() }));
      }
      if (op.filter) assertNoMask(op.filter, whereType());
      break;
    case 'rename-module':
      if (typeof op.name !== 'string' || !op.name.trim()) {
        throw new BlueprintEditError(msg('edit.makeOpName', { where: whereType() }));
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
        return msg('edit.makeFilterRemoved', { id: op.moduleId });
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
  if (!found) throw new BlueprintEditError(msg('edit.makeModuleNotFound', { id: moduleId }));
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
      return carried > 0 ? msg('edit.makeRemoveCarries', { id: moduleId, count: carried }) : null;
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
  if (result === undefined) throw new BlueprintEditError(msg('edit.makeModuleNotFound', { id: moduleId }));
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
  return msg('edit.makeFieldAbsent', { path: `${section}.${path}`, id: module.id });
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
    throw new BlueprintEditError(msg('edit.makePatchInvalid', { label }));
  }
  if (hasAccountKey(value)) throw new BlueprintEditError(accountKeyRefusal(label));
  assertNoMask(value, label);
}

function assertNoMask(value: unknown, label: string): void {
  if (JSON.stringify(value).includes(SECRET_MASK)) {
    throw new BlueprintEditError(msg('edit.makeMaskCopied', { label, mask: `${SECRET_MASK} …]` }));
  }
}

function hasAccountKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasAccountKey);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, child]) => ACCOUNT_KEY.test(key) || hasAccountKey(child));
}

function accountKeyRefusal(label: string): string {
  return msg('edit.makeAccountKey', { label });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
