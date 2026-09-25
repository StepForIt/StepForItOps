/**
 * Conformité d'un module à SON PROPRE schéma.
 *
 * Découverte faite sur un blueprint réel, et qui contredit ce qu'on croyait :
 * Make embarque la description de chaque module DANS le scénario.
 * `metadata.parameters[]` décrit les réglages statiques, `metadata.expect[]`
 * décrit les champs du `mapper` — type, caractère requis, valeurs admises
 * (`validate.enum`), et jusqu'à la structure des collections (`spec`).
 *
 * Il n'y a donc pas besoin d'un catalogue pour vérifier ce qui est ÉCRIT. La
 * limite est ailleurs, et elle est réelle : ça ne décrit que les modules déjà
 * présents. Pour un module qu'on voudrait AJOUTER, il n'y a toujours rien.
 *
 * Le parti pris est celui qui a fait ses preuves côté n8n : on se tait dès qu'on
 * n'est pas sûr. Un module sans schéma déclaré ne produit rien — c'est un trou
 * de la description, pas une faute du scénario.
 */
import { CheckFinding } from '../check-finding';
import { FlatModule, MakeModule, moduleLabel } from './blueprint';

export interface MakeFieldSpec {
  name?: string;
  type?: string;
  label?: string;
  required?: boolean;
  validate?: { enum?: unknown[]; pattern?: string; min?: number; max?: number };
  /** Sous-champs d'un `array` ou d'une `collection`. */
  spec?: MakeFieldSpec | MakeFieldSpec[];
}

interface ModuleSchema {
  /** Décrit `parameters`. */
  parameters?: MakeFieldSpec[];
  /** Décrit `mapper`. */
  expect?: MakeFieldSpec[];
}

/**
 * Les clés que Make gère lui-même et qui n'apparaissent dans aucun schéma.
 * Même raison que `pollTimes` / `requestOptions` côté n8n : les compter comme
 * inconnues produirait un finding par module, tous faux.
 */
function isInternalKey(key: string): boolean {
  return key.startsWith('__') || key === 'feeder';
}

/** Une valeur qui porte une expression vient d'ailleurs : on ne peut pas la juger. */
function isExpressionValue(value: unknown): boolean {
  return typeof value === 'string' && value.includes('{{');
}

export function runMakeSchemaChecks(modules: FlatModule[]): CheckFinding[] {
  return modules.flatMap((flat) => checkModule(flat.module));
}

function checkModule(module: MakeModule): CheckFinding[] {
  const schema = (module.metadata ?? {}) as unknown as ModuleSchema;
  const findings: CheckFinding[] = [];
  const label = moduleLabel(module);

  findings.push(...checkSection(label, module.mapper, schema.expect, 'mapper'));
  findings.push(...checkSection(label, module.parameters, schema.parameters, 'parameters'));
  return findings;
}

function checkSection(
  label: string,
  values: Record<string, unknown> | undefined,
  specs: MakeFieldSpec[] | undefined,
  section: 'mapper' | 'parameters',
): CheckFinding[] {
  // Pas de description ⇒ rien à comparer. C'est un trou de la description, pas
  // une faute : Make ne décrit pas tous ses modules dans tous les blueprints.
  if (!Array.isArray(specs) || specs.length === 0) return [];
  const findings: CheckFinding[] = [];
  const byName = new Map(specs.filter((spec) => spec.name).map((spec) => [spec.name as string, spec]));

  for (const [key, value] of Object.entries(values ?? {})) {
    if (isInternalKey(key)) continue;
    const spec = byName.get(key);
    if (!spec) {
      findings.push({
        severity: 'warning',
        code: 'make-unknown-field',
        message: `« ${label} » déclare « ${key} », que ce module ne connaît pas : Make l'ignore, et la valeur n'arrivera jamais.`,
        nodeName: label,
        data: { field: key, section },
      });
      continue;
    }
    findings.push(...checkValue(label, key, value, spec));
  }

  for (const spec of specs) {
    if (!spec.required || !spec.name) continue;
    const value = (values ?? {})[spec.name];
    if (value === undefined || value === null || value === '') {
      findings.push({
        severity: 'error',
        code: 'make-required-field-missing',
        message: `« ${label} » n'a pas de valeur pour « ${spec.label ?? spec.name} », que le module exige : il échouera à l'exécution.`,
        nodeName: label,
        data: { field: spec.name, section },
      });
    }
  }

  return findings;
}

function checkValue(label: string, key: string, value: unknown, spec: MakeFieldSpec): CheckFinding[] {
  if (isExpressionValue(value) || value === undefined || value === null) return [];

  const allowed = spec.validate?.enum;
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(value as never)) {
    return [
      {
        severity: 'error',
        code: 'make-value-not-allowed',
        message:
          `« ${label} » met « ${String(value)} » dans « ${spec.label ?? key} », qui n'admet que ` +
          `${allowed.map((option) => `« ${String(option)} »`).join(', ')}.`,
        nodeName: label,
        data: { field: key, value, allowed },
      },
    ];
  }

  const expected = expectedKind(spec.type);
  if (expected && actualKind(value) !== expected) {
    return [
      {
        severity: 'warning',
        code: 'make-field-type',
        message:
          `« ${label} » met ${describe(value)} dans « ${spec.label ?? key} », que le module attend en ` +
          `${expected}.`,
        nodeName: label,
        data: { field: key, expected, got: actualKind(value) },
      },
    ];
  }
  return [];
}

/**
 * On ne juge que les types dont l'écart a une conséquence. `text`, `url`,
 * `select` ou `filter` acceptent trop de formes pour qu'un désaccord veuille
 * dire quelque chose.
 */
function expectedKind(type: string | undefined): string | undefined {
  if (type === 'boolean') return 'booléen';
  if (type === 'number' || type === 'uinteger' || type === 'integer') return 'nombre';
  if (type === 'array') return 'liste';
  if (type === 'collection') return 'objet';
  return undefined;
}

function actualKind(value: unknown): string {
  if (Array.isArray(value)) return 'liste';
  if (typeof value === 'boolean') return 'booléen';
  if (typeof value === 'number') return 'nombre';
  if (value !== null && typeof value === 'object') return 'objet';
  return 'texte';
}

function describe(value: unknown): string {
  const kind = actualKind(value);
  return kind === 'texte' ? `le texte « ${String(value)} »` : `${kind === 'liste' ? 'une' : 'un'} ${kind}`;
}
