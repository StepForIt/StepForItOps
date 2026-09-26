/**
 * Branches de paramètres INERTES d'un nœud n8n : n8n garde dans le JSON la
 * valeur des champs que la config courante masque (mapping manuel sous « Map
 * Automatically », body avec `sendBody: false`…) sans jamais les exécuter —
 * les analyser produit des faux positifs (`field-unknown`,
 * `expression-missing-node`). Faute de pouvoir rejouer `displayOptions`, on
 * encode les seules règles certaines, vérifiables dans le JSON seul : un champ
 * masqué à tort est un finding perdu.
 */

import { N8nNode } from './workflow.types';
import { msg } from '../../i18n/translate';

type Params = Record<string, unknown>;

export interface InertBranch {
  /** Chemin de la branche morte, relatif au nœud (ex. `$.parameters.columns.value`). */
  path: string;
  /** Pourquoi n8n l'ignore — repris tel quel dans les explications UI. */
  reason: string;
}

const ROOT = '$.parameters';

function isObject(value: unknown): value is Params {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringAt(params: Params, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

/** n8n omet le booléen quand il vaut son défaut : `undefined` = désactivé ici. */
function isOn(params: Params, key: string): boolean {
  return params[key] === true;
}

function branch(path: string, key: string, reason: string, params: Params): InertBranch[] {
  return key in params ? [{ path: `${path}.${key}`, reason }] : [];
}

/**
 * `resourceMapper` (Airtable, Google Sheets, Postgres, MySQL, NocoDB…) : hors
 * mode `defineBelow`, les colonnes sont déduites de l'entrée et `value` n'est
 * plus qu'un vestige de l'ancien mapping manuel. Le paramètre ne s'appelle pas
 * toujours `columns` selon le nœud → on le reconnaît à sa forme, à toute
 * profondeur.
 */
function resourceMapperBranches(value: unknown, path: string): InertBranch[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => resourceMapperBranches(item, `${path}[${index}]`));
  }
  if (!isObject(value)) return [];

  const mode = stringAt(value, 'mappingMode');
  const isInertMapper = !!mode && mode !== 'defineBelow' && isObject(value.value);
  const here: InertBranch[] = isInertMapper
    ? [
        {
          path: `${path}.value`,
          reason: msg('checks.inertMapper', { mode }),
        },
      ]
    : [];

  return Object.entries(value)
    .filter(([key]) => !(isInertMapper && key === 'value'))
    .flatMap(([key, child]) => resourceMapperBranches(child, `${path}.${key}`))
    .concat(here);
}

/** Nœud Set / « Edit Fields » : `manual` (défaut) et `raw` s'excluent. */
function setNodeBranches(params: Params): InertBranch[] {
  if (stringAt(params, 'mode') === 'raw') {
    const reason = msg('checks.inertSetRaw');
    return ['assignments', 'fields', 'values'].flatMap((key) => branch(ROOT, key, reason, params));
  }
  return branch(ROOT, 'jsonOutput', msg('checks.inertSetFields'), params);
}

/** Nœud Code : le langage choisi décide quel bloc est exécuté. */
function codeNodeBranches(params: Params): InertBranch[] {
  const language = stringAt(params, 'language') ?? 'javaScript';
  return language.startsWith('python')
    ? branch(ROOT, 'jsCode', msg('checks.inertCode', { language: 'python' }), params)
    : branch(ROOT, 'pythonCode', msg('checks.inertCode', { language: 'javaScript' }), params);
}

/**
 * HTTP Request : chaque section (body / query / headers) est conditionnée par
 * son interrupteur `send*`, puis par `specify*` qui tranche entre la saisie
 * clé/valeur et le JSON brut.
 */
function httpRequestBranches(params: Params): InertBranch[] {
  const sections = [
    {
      toggle: 'sendBody',
      specify: 'specifyBody',
      pairs: 'bodyParameters',
      json: 'jsonBody',
      section: 'body',
    },
    {
      toggle: 'sendQuery',
      specify: 'specifyQuery',
      pairs: 'queryParameters',
      json: 'jsonQuery',
      section: 'query',
    },
    {
      toggle: 'sendHeaders',
      specify: 'specifyHeaders',
      pairs: 'headerParameters',
      json: 'jsonHeaders',
      section: 'headers',
    },
  ];

  return sections.flatMap(({ toggle, specify, pairs, json, section }) => {
    if (!isOn(params, toggle)) {
      const reason = msg('checks.inertHttpOff', { toggle, section });
      return [pairs, json].flatMap((key) => branch(ROOT, key, reason, params));
    }
    const useJson = stringAt(params, specify) === 'json';
    const reason = useJson
      ? msg('checks.inertHttpJson', { section })
      : msg('checks.inertHttpPairs', { section });
    return branch(ROOT, useJson ? pairs : json, reason, params);
  });
}

/** Le `type` n8n ne porte pas la version (c'est `typeVersion`) : égalité stricte. */
const BY_TYPE: Record<string, (params: Params) => InertBranch[]> = {
  'n8n-nodes-base.set': setNodeBranches,
  'n8n-nodes-base.code': codeNodeBranches,
  'n8n-nodes-base.httpRequest': httpRequestBranches,
};

/** Toutes les branches de paramètres que n8n n'exécutera pas, pour ce nœud. */
export function inertParamBranches(node: N8nNode): InertBranch[] {
  const params = node.parameters;
  if (!isObject(params)) return [];
  const byType = BY_TYPE[node.type]?.(params) ?? [];
  return [...byType, ...resourceMapperBranches(params, ROOT)];
}

/** Retire une branche `$.parameters.a.b` d'une copie des paramètres. */
function dropAt(params: Params, path: string): void {
  const segments = path.slice(`${ROOT}.`.length).split('.');
  const key = segments.pop()!;
  let target: unknown = params;
  for (const segment of segments) {
    if (!isObject(target)) return;
    target = target[segment];
  }
  if (isObject(target)) delete target[key];
}

/**
 * Paramètres du nœud amputés de ses branches inertes — à utiliser par toute
 * analyse qui juge les expressions. Seules des CLÉS d'objet sont retirées :
 * les chemins des paramètres restants (et donc des findings) sont inchangés.
 */
export function activeParameters(node: N8nNode): Params {
  const params = node.parameters;
  if (!isObject(params)) return {};
  const branches = inertParamBranches(node);
  if (branches.length === 0) return params;

  const copy = structuredClone(params) as Params;
  for (const { path } of branches) dropAt(copy, path);
  return copy;
}
