/**
 * Le schéma d'un type de nœud n8n, et ce qu'on peut en tirer sans IO.
 *
 * D'où ça vient : jusqu'ici, la seule norme dont disposait la plateforme était le
 * CORPUS (`param-shape.ts`) — « onze nœuds Notion mettent un objet ici, celui-ci
 * met une chaîne ». C'est un signal, pas une preuve, et il est muet sur un type de
 * nœud que l'instance n'emploie pas encore : le cas exact d'un `add-node` proposé
 * par l'assistant, où l'on n'a rien à quoi comparer.
 *
 * Le schéma, lui, est la description que n8n donne de ses propres nœuds : le
 * tableau `INodeProperties` que l'éditeur lit pour dessiner le panneau. Il dit
 * quels paramètres existent, de quel type, et — par `displayOptions` — lesquels
 * s'appliquent à la configuration courante.
 *
 * Ce fichier ne connaît ni la provenance du schéma (catalogue mutualisé, instance
 * n8n) ni la façon dont il est stocké : il reçoit des schémas et rend des findings.
 */

import { activeParameters } from './inert-params';
import { CheckFinding } from './structural-checks';
import { N8nNode, N8nWorkflow } from './workflow.types';

/**
 * Condition n8n autre que l'égalité. n8n les sérialise sous `{_cnd: {gte: 2}}` ;
 * on en lit ce qu'on sait évaluer, et le reste rend `undefined` — jamais `false`,
 * cf. `matchesCondition`.
 */
export interface DisplayCondition {
  eq?: unknown;
  not?: unknown;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  between?: { from: number; to: number };
  startsWith?: string;
  endsWith?: string;
  includes?: string;
  regex?: string;
}

export type DisplayValue = string | number | boolean | null | { _cnd?: DisplayCondition };

/** Règles de visibilité d'une propriété, telles que n8n les écrit. */
export interface DisplayOptions {
  /** Toutes les clés doivent correspondre pour que la propriété soit visible. */
  show?: Record<string, DisplayValue[] | undefined>;
  /** Toutes les clés correspondent ⇒ la propriété est masquée. */
  hide?: Record<string, DisplayValue[] | undefined>;
}

/** Une propriété déclarée par un type de nœud (forme `INodeProperties` de n8n). */
export interface NodeProperty {
  name: string;
  displayName?: string;
  /** string | number | boolean | options | collection | fixedCollection | json | resourceLocator… */
  type?: string;
  default?: unknown;
  description?: string;
  displayOptions?: DisplayOptions;
  /** Valeurs admises d'un `options`, ou sous-propriétés d'une collection. */
  options?: Array<NodeProperty | { name?: string; value?: unknown; description?: string }>;
  values?: NodeProperty[];
  required?: boolean;
  noDataExpression?: boolean;
}

/** Ce que la plateforme retient d'un type de nœud, quelle qu'en soit la source. */
export interface NodeSchema {
  /** Forme longue, celle du JSON n8n : `n8n-nodes-base.slack`. */
  nodeType: string;
  displayName?: string;
  /** Version la plus haute décrite par ce schéma. */
  version?: number;
  properties: NodeProperty[];
  /** Provenance, pour que le message dise à quoi il confronte. */
  source: NodeSchemaSource;
}

/**
 * Provenance d'un schéma. Elle change ce qu'on a le droit d'affirmer : un schéma
 * lu sur l'instance décrit le n8n qui exécutera le workflow, un schéma du
 * catalogue mutualisé décrit un n8n voisin — proche, jamais garanti identique.
 */
export type NodeSchemaSource = 'instance' | 'catalog';

/** Sévérité retenue : le catalogue mutualisé n'a pas à bloquer une écriture. */
const SEVERITY = 'warning' as const;

/** Une valeur de paramètre qui est une expression n8n (`={{ … }}`) ne se juge pas. */
function isExpression(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('=');
}

/**
 * Évalue une condition de `displayOptions` contre la valeur courante.
 *
 * Rend `undefined` — et non `false` — dès qu'on ne sait pas trancher : condition
 * inconnue, valeur portée par une expression. L'indécis remonte jusqu'à
 * `isVisible`, qui préfère alors montrer la propriété. Un contrôle qui se tait
 * vaut mieux qu'un contrôle qui accuse à tort : c'est toute la différence entre
 * une aide et un bruit qu'on finit par décocher.
 */
function matchesCondition(current: unknown, expected: DisplayValue): boolean | undefined {
  if (expected !== null && typeof expected === 'object' && '_cnd' in expected) {
    const condition = expected._cnd;
    if (!condition) return undefined;
    if ('eq' in condition) return current === condition.eq;
    if ('not' in condition) return current !== condition.not;
    if (typeof current === 'number') {
      if (typeof condition.gte === 'number') return current >= condition.gte;
      if (typeof condition.lte === 'number') return current <= condition.lte;
      if (typeof condition.gt === 'number') return current > condition.gt;
      if (typeof condition.lt === 'number') return current < condition.lt;
      if (condition.between) {
        return current >= condition.between.from && current <= condition.between.to;
      }
    }
    if (typeof current === 'string') {
      if (typeof condition.startsWith === 'string') return current.startsWith(condition.startsWith);
      if (typeof condition.endsWith === 'string') return current.endsWith(condition.endsWith);
      if (typeof condition.includes === 'string') return current.includes(condition.includes);
      if (typeof condition.regex === 'string') {
        try {
          return new RegExp(condition.regex).test(current);
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }
  return current === expected;
}

/** Une clause `show`/`hide` : au moins une valeur admise doit correspondre. */
function clauseMatches(current: unknown, allowed: DisplayValue[]): boolean | undefined {
  if (isExpression(current)) return undefined;
  let undecided = false;
  for (const expected of allowed) {
    const verdict = matchesCondition(current, expected);
    if (verdict === true) return true;
    if (verdict === undefined) undecided = true;
  }
  return undecided ? undefined : false;
}

/**
 * Valeur courante d'une clé de `displayOptions`. n8n admet quelques préfixes de
 * chemin (`/param` pour la racine) : on les rabat sur le nom, le contrôle ne
 * descendant pas dans les collections.
 */
function currentValueOf(
  key: string,
  parameters: Record<string, unknown>,
  typeVersion: number | undefined,
  properties: NodeProperty[],
): unknown {
  if (key === '@version') return typeVersion;
  const name = key.replace(/^[/@]+/, '');
  if (name in parameters) return parameters[name];
  // Paramètre laissé à sa valeur par défaut : n8n raisonne sur la valeur
  // effective, et le JSON n'écrit pas ce qui n'a pas été touché.
  const declared = properties.find((property) => property.name === name);
  return declared?.default;
}

/**
 * La propriété s'applique-t-elle à cette configuration ?
 *
 * `true` quand elle est visible, `false` quand elle est certainement masquée,
 * `undefined` quand une condition n'a pas pu être tranchée. Les appelants
 * traitent `undefined` comme visible.
 */
export function isVisible(
  property: NodeProperty,
  parameters: Record<string, unknown>,
  typeVersion: number | undefined,
  properties: NodeProperty[],
): boolean | undefined {
  const rules = property.displayOptions;
  if (!rules) return true;

  let undecided = false;
  for (const [key, allowed] of Object.entries(rules.show ?? {})) {
    if (!allowed) continue;
    const verdict = clauseMatches(currentValueOf(key, parameters, typeVersion, properties), allowed);
    if (verdict === false) return false;
    if (verdict === undefined) undecided = true;
  }

  // `hide` ne masque que si TOUTES ses clauses correspondent : un seul « non »
  // suffit à laisser la propriété visible.
  const hideEntries = Object.entries(rules.hide ?? {}).filter(([, allowed]) => allowed);
  if (hideEntries.length > 0) {
    let allHide = true;
    for (const [key, allowed] of hideEntries) {
      const verdict = clauseMatches(
        currentValueOf(key, parameters, typeVersion, properties),
        allowed as DisplayValue[],
      );
      if (verdict !== true) allHide = false;
      if (verdict === undefined) undecided = true;
    }
    if (allHide) return false;
  }

  return undecided ? undefined : true;
}

/** Noms des propriétés qui s'appliquent (l'indécis compte comme applicable). */
export function applicableProperties(
  schema: NodeSchema,
  parameters: Record<string, unknown>,
  typeVersion: number | undefined,
): NodeProperty[] {
  return schema.properties.filter(
    (property) => isVisible(property, parameters, typeVersion, schema.properties) !== false,
  );
}

/**
 * Noms de sous-collections déclarés par une `fixedCollection`.
 *
 * C'est la liste que n8n confronte aux clés du JSON quand il reconstruit un
 * nœud (`getNodeParameters`, packages/workflow/src/node-helpers.ts) : une clé
 * absente de cette liste est soit REFUSÉE — « Could not find property option »,
 * et c'est l'import du workflow ENTIER qui échoue, sans dire quel nœud —, soit,
 * sur les n8n plus récents où ce `throw` est devenu un `continue`,
 * silencieusement JETÉE. Le second cas est le pire : le workflow s'importe,
 * l'éditeur ne dit rien, et le paramètre n'existe simplement pas.
 *
 * Le nom fautif est toujours plausible (`values`, `value`, `items`) — c'est la
 * signature d'un JSON écrit par une IA ou par l'API, là où l'éditeur n8n aurait
 * posé le nom déclaré (`fileUrl`).
 */
export function collectionKeys(property: NodeProperty): string[] | undefined {
  if (property.type !== 'fixedCollection') return undefined;
  const names = (property.options ?? [])
    .map((option) => (option && typeof option === 'object' && 'name' in option ? option.name : undefined))
    .filter((name): name is string => typeof name === 'string');
  return names.length > 0 ? names : undefined;
}

/** Sous-propriétés déclarées derrière une sous-clé de `fixedCollection`. */
function subPropertiesOf(property: NodeProperty, key: string): NodeProperty[] {
  const option = (property.options ?? []).find(
    (candidate) =>
      candidate && typeof candidate === 'object' && 'name' in candidate && candidate.name === key,
  ) as { values?: NodeProperty[] } | undefined;
  return option?.values ?? [];
}

/** Profondeur de descente. Au-delà on décrirait du contenu métier, pas de la structure. */
const MAX_COLLECTION_DEPTH = 5;

/** Ce qu'une descente dans les collections d'un paramètre a relevé. */
export interface CollectionIssue {
  /**
   * `unknown-key` : sous-clé non déclarée — n8n refuse l'import ou jette la valeur.
   * `not-a-collection` : une expression là où n8n attend une collection. Elle ne
   * lève rien (n8n saute les valeurs non-objet) et ne marche pas davantage : une
   * `fixedCollection` a un nombre d'entrées FIXE, aucune expression ne peut en
   * produire un nombre variable. C'est le pire des cas — tout paraît normal.
   */
  kind: 'unknown-key' | 'not-a-collection';
  /** Chemin lisible, tel qu'on le retrouve dans le JSON : `propertiesUi.propertyValues[].fileUrls`. */
  path: string;
  keys: string[];
  expected: string[];
}

/**
 * Descend dans les collections d'un paramètre et relève les sous-clés non
 * déclarées, à TOUS les niveaux.
 *
 * La récursion n'est pas un raffinement : le cas qui casse un import pour de bon
 * — un `fileUrls: { values: … }` là où le nœud Notion déclare `fileUrl` — vit
 * sous `propertiesUi.propertyValues[]`, donc à trois niveaux de la racine. Un
 * contrôle qui s'arrête au premier niveau ne voit rien de ce qui compte.
 */
export function unknownCollectionKeys(
  property: NodeProperty,
  value: unknown,
  path: string,
  depth = 0,
): CollectionIssue[] {
  if (depth > MAX_COLLECTION_DEPTH || value === null) return [];

  if (typeof value !== 'object') {
    // Une expression à la place de la collection : n8n l'accepte à l'écriture,
    // la saute à la lecture, et le paramètre n'existe pas à l'exécution.
    if (property.type === 'fixedCollection' && typeof value === 'string' && value.startsWith('=')) {
      return [{ kind: 'not-a-collection', path, keys: [], expected: collectionKeys(property) ?? [] }];
    }
    return [];
  }

  // Une collection à valeurs multiples arrive en tableau : on inspecte chaque item.
  if (Array.isArray(value)) {
    return value.flatMap((item) => unknownCollectionKeys(property, item, path, depth));
  }

  const entries = value as Record<string, unknown>;
  const findings: CollectionIssue[] = [];

  if (property.type === 'fixedCollection') {
    const declared = collectionKeys(property);
    if (!declared) return [];
    const unknown = Object.keys(entries).filter((key) => !declared.includes(key));
    if (unknown.length > 0) findings.push({ kind: 'unknown-key', path, keys: unknown, expected: declared });

    for (const key of Object.keys(entries)) {
      if (unknown.includes(key)) continue;
      const items = Array.isArray(entries[key]) ? (entries[key] as unknown[]) : [entries[key]];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        for (const sub of subPropertiesOf(property, key)) {
          const held = (item as Record<string, unknown>)[sub.name];
          if (held === undefined) continue;
          findings.push(...unknownCollectionKeys(sub, held, `${path}.${key}[].${sub.name}`, depth + 1));
        }
      }
    }
    return findings;
  }

  if (property.type === 'collection') {
    // Une `collection` ne borne pas ses clés de la même façon : on ne juge donc
    // pas ce niveau, on traverse seulement vers les collections qu'il contient.
    for (const sub of (property.options ?? []) as NodeProperty[]) {
      if (!sub || typeof sub !== 'object' || !('name' in sub)) continue;
      const held = entries[sub.name];
      if (held === undefined) continue;
      findings.push(...unknownCollectionKeys(sub, held, `${path}.${sub.name}`, depth + 1));
    }
  }
  return findings;
}

/** Valeurs admises d'une propriété `options`, ou `undefined` si ce n'en est pas une. */
export function allowedValues(property: NodeProperty): unknown[] | undefined {
  if (property.type !== 'options') return undefined;
  const values = (property.options ?? [])
    .map((option) => (option && typeof option === 'object' && 'value' in option ? option.value : undefined))
    .filter((value) => value !== undefined);
  return values.length > 0 ? values : undefined;
}

/**
 * Types dont n8n attend un OBJET dans le JSON. C'est ici qu'un workflow s'est
 * cassé pour de bon : un `fileUrls` passé en chaîne là où l'éditeur attend un
 * objet, et n8n n'a plus rouvert le workflow. Une expression ne sauve pas le cas
 * — ces champs-là n'en acceptent pas à leur racine.
 */
const OBJECT_TYPES = new Set([
  'fixedCollection',
  'collection',
  'resourceLocator',
  'resourceMapper',
  'assignmentCollection',
  'filter',
]);

/** Le genre JSON d'une valeur est-il compatible avec le type déclaré ? */
function typeMismatch(property: NodeProperty, value: unknown): string | undefined {
  const declared = property.type;
  if (!declared) return undefined;
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);

  if (OBJECT_TYPES.has(declared)) {
    // Une collection à valeurs multiples est écrite en TABLEAU par n8n : la
    // refuser accusait des nœuds QuickBooks parfaitement corrects.
    if ((declared === 'fixedCollection' || declared === 'collection') && Array.isArray(value))
      return undefined;
    return isObject ? undefined : `un objet est attendu, ce nœud porte ${jsonKind(value)}`;
  }
  // Hors types objet, une expression est légitime partout : elle sera résolue à
  // l'exécution, et son résultat nous est inconnu.
  if (isExpression(value)) return undefined;
  if (declared === 'boolean' && typeof value !== 'boolean') {
    return `un booléen est attendu, ce nœud porte ${jsonKind(value)}`;
  }
  if (declared === 'number' && typeof value !== 'number') {
    return `un nombre est attendu, ce nœud porte ${jsonKind(value)}`;
  }
  return undefined;
}

function jsonKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'un tableau';
  const type = typeof value;
  if (type === 'string') return 'une chaîne';
  if (type === 'number') return 'un nombre';
  if (type === 'boolean') return 'un booléen';
  return 'un objet';
}

/**
 * Paramètres que le FRAMEWORK n8n injecte, et qui n'apparaissent donc dans le
 * schéma d'aucun nœud : la cadence d'un déclencheur à scrutation, la description
 * d'un nœud employé comme outil d'agent. Mesurés sur 2 352 workflows publics,
 * ils représentaient à eux seuls la majorité des « paramètres inconnus ».
 */
const META_PARAMS = new Set([
  'notice',
  'notesInFlow',
  'color',
  // Déclencheurs à scrutation : n8n pose l'intervalle hors du schéma du nœud.
  'pollTimes',
  // Variantes « Tool » d'un nœud, employées par un agent IA.
  'descriptionType',
  'toolDescription',
  // Nœuds déclaratifs : n8n y greffe les options de requête hors schéma.
  'requestOptions',
]);

/**
 * Confronte les nœuds d'un workflow aux schémas connus.
 *
 * Trois principes, tous là pour éviter le faux positif à l'échelle :
 * - un nœud sans schéma connu n'est PAS un finding : c'est un trou du catalogue,
 *   pas une faute du workflow ;
 * - seuls les paramètres de premier niveau sont jugés — descendre dans les
 *   collections demanderait de résoudre les `displayOptions` de chaque niveau,
 *   et c'est là que le bruit commence ;
 * - un schéma ne décrit qu'UNE version : dès que la `typeVersion` du nœud n'est
 *   pas celle-là, on se tait (cf. `checkNode`).
 *
 * La carte est donc indexée par `schemaKey` : un schéma daté d'une version
 * précise sous `type@version`, un schéma « dernière version connue » sous le
 * seul `type`. Le premier gagne — c'est exactement la description que n8n
 * servira au nœud tel qu'il est écrit, et la seule qui lève la règle ci-dessus.
 */
export function runNodeSchemaChecks(workflow: N8nWorkflow, schemas: Map<string, NodeSchema>): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const node of workflow.nodes ?? []) {
    const schema = schemas.get(schemaKey(node.type, node.typeVersion)) ?? schemas.get(node.type);
    if (!schema || schema.properties.length === 0) continue;
    findings.push(...checkNode(node, schema));
  }
  return findings;
}

/**
 * Clé d'un schéma dans la carte passée aux contrôles.
 *
 * `type@version` quand on tient la description de CETTE version, `type` seul
 * sinon. Sans cette distinction, une instance qui décrit trois versions d'un
 * même nœud n'en aurait qu'une en carte, et ce serait la dernière écrite.
 */
export function schemaKey(nodeType: string, typeVersion?: number): string {
  return typeVersion === undefined ? nodeType : `${nodeType}@${typeVersion}`;
}

function checkNode(node: N8nNode, schema: NodeSchema): CheckFinding[] {
  // Le catalogue mutualisé ne décrit qu'UNE version par type — la plus haute. Or
  // sur 2 352 workflows publics mesurés, 45 % des nœuds tournent sur une version
  // ANTÉRIEURE, dont les paramètres portaient d'autres noms et d'autres formes :
  // `sheetName` était une chaîne avant de devenir un resourceLocator,
  // `appendOrUpdate` n'existait pas encore. Les juger sur le schéma de la
  // dernière version produisait 2 546 faux positifs à lui seul.
  //
  // On ne juge donc QUE ce qui est vraiment décrit : version pour version.
  //
  // L'instance n'y échappe pas non plus, contrairement à ce qu'on croyait
  // d'abord. `/types/nodes.json` sert la description COURANTE d'un type, pas
  // celle qui a shippé avec la typeVersion 2 : elle dit quelles versions elle
  // sert, jamais ce que chacune déclarait. Mesure sur les 2 352 workflows
  // publics : juger hors de sa version fait 5 « sous-clés non déclarées » et
  // les 5 sont fausses — le Switch v2 range ses règles sous `rules`, le v3 sous
  // `values`. Or c'est la seule `error` du lot, celle qui ferme la porte
  // DEV/PROD : cinq faux positifs coûtent ici cinq workflows qu'on ne peut plus
  // modifier du tout.
  if (schema.version !== undefined && node.typeVersion !== schema.version) return [];

  // `activeParameters` et non `node.parameters` : n8n conserve dans le JSON les
  // champs que la config courante masque, et les juger reviendrait à contrôler
  // du code mort.
  const parameters = activeParameters(node) as Record<string, unknown>;
  // Un nom de paramètre porte SOUVENT plusieurs propriétés : un nœud Google Drive
  // déclare une `operation` par ressource (fichier, dossier, fichier-ou-dossier),
  // chacune avec ses propres valeurs. N'en garder qu'une — la dernière — faisait
  // refuser `download` comme « non proposée » alors qu'elle l'est par une autre.
  // On raisonne donc par NOM, sur l'union des propriétés qui s'appliquent.
  const declared = new Map<string, NodeProperty[]>();
  for (const property of schema.properties) {
    declared.set(property.name, [...(declared.get(property.name) ?? []), property]);
  }
  const applicableByName = new Map<string, NodeProperty[]>();
  for (const property of applicableProperties(schema, parameters, node.typeVersion)) {
    applicableByName.set(property.name, [...(applicableByName.get(property.name) ?? []), property]);
  }
  const origin = schema.source === 'instance' ? "le schéma de l'instance" : 'le catalogue des nœuds';
  const findings: CheckFinding[] = [];

  for (const [name, value] of Object.entries(parameters)) {
    if (META_PARAMS.has(name)) continue;
    const variants = declared.get(name);

    if (!variants) {
      findings.push({
        severity: SEVERITY,
        code: 'node-unknown-param',
        nodeName: node.name,
        message: `Paramètre « ${name} » inconnu du nœud ${schema.displayName ?? node.type} d'après ${origin}.`,
        data: { param: name, nodeType: node.type, source: schema.source },
      });
      continue;
    }

    // Déclaré mais hors configuration courante : n8n ne l'exécutera pas. Ce
    // n'est pas une faute — c'est du résidu — donc pas de finding, `verifier`
    // ayant déjà `activeParameters` pour ne pas s'y laisser prendre.
    const applicable = applicableByName.get(name);
    if (!applicable) continue;

    // Une seule variante acceptant la valeur suffit à la dédouaner.
    const mismatches = applicable.map((property) => typeMismatch(property, value));
    if (mismatches.every((mismatch) => mismatch)) {
      findings.push({
        severity: SEVERITY,
        code: 'node-param-type',
        nodeName: node.name,
        message: `Paramètre « ${name} » : ${mismatches[0]} (type ${applicable[0].type} d'après ${origin}).`,
        data: { param: name, expected: applicable[0].type, nodeType: node.type, source: schema.source },
      });
      continue;
    }

    // Sous-clés de collection, à tous les niveaux. Contrôle bon marché et sans
    // ambiguïté : la liste est DÉCLARÉE par le nœud, on ne devine rien.
    //
    // Une seule variante applicable qui accepte la forme suffit à dédouaner le
    // paramètre : on ne retient donc que ce que TOUTES signalent, au même endroit.
    const perVariant = applicable.map((property) => unknownCollectionKeys(property, value, name));
    const counts = new Map<string, { issue: CollectionIssue; seen: number }>();
    for (const issues of perVariant) {
      for (const issue of new Map(
        issues.map((i) => [`${i.kind}|${i.path}|${i.keys.join(',')}`, i]),
      ).values()) {
        const key = `${issue.kind}|${issue.path}|${issue.keys.join(',')}`;
        counts.set(key, { issue, seen: (counts.get(key)?.seen ?? 0) + 1 });
      }
    }
    const agreed = [...counts.values()]
      .filter((entry) => entry.seen === applicable.length)
      .map((e) => e.issue);
    if (agreed.length > 0) {
      for (const issue of agreed) {
        const expected = issue.expected.map((key) => `« ${key} »`).join(', ');
        findings.push(
          issue.kind === 'unknown-key'
            ? {
                // La seule `error` de ce contrôle : le workflow ne s'importe pas,
                // ou s'importe amputé du paramètre. Dans les deux cas ce qui est
                // écrit ne s'exécutera jamais, et l'assistant ne doit pas pouvoir
                // le proposer — la porte DEV/PROD s'appuie sur cette sévérité.
                severity: 'error',
                code: 'node-unknown-collection-key',
                nodeName: node.name,
                message:
                  `${issue.path} : ${issue.keys.map((key) => `« ${key} »`).join(', ')} ` +
                  `${issue.keys.length > 1 ? 'ne sont pas des sous-clés déclarées' : "n'est pas une sous-clé déclarée"} ` +
                  `par ${schema.displayName ?? node.type} (attendu : ${expected}). n8n refuse alors d'importer le ` +
                  `workflow (« Could not find property option ») ou jette la valeur en silence.`,
                data: {
                  param: name,
                  path: issue.path,
                  unknownKeys: issue.keys,
                  expectedKeys: issue.expected,
                  nodeType: node.type,
                  source: schema.source,
                  suggestion:
                    `Dans le nœud « ${node.name} », renomme ${issue.keys.map((key) => `\`${key}\``).join(', ')} ` +
                    `sous \`${issue.path}\` en ${issue.expected.map((key) => `\`${key}\``).join(' ou ')}.`,
                },
              }
            : {
                severity: SEVERITY,
                code: 'node-expression-collection',
                nodeName: node.name,
                message:
                  `${issue.path} porte une expression là où ${schema.displayName ?? node.type} attend une ` +
                  `collection (sous-clé ${expected}). n8n ne lève rien mais saute la valeur : une collection a un ` +
                  `nombre d'entrées FIXE, aucune expression ne peut en produire un nombre variable.`,
                data: {
                  param: name,
                  path: issue.path,
                  expectedKeys: issue.expected,
                  nodeType: node.type,
                  source: schema.source,
                  suggestion:
                    `Pose les entrées une à une sous \`${issue.path}\`, ou — s'il en faut un nombre variable — ` +
                    `sors du nœud et fais l'appel en HTTP Request avec le tableau construit en amont.`,
                },
              },
        );
      }
      continue;
    }

    const lists = applicable.map((property) => allowedValues(property)).filter(Boolean) as unknown[][];
    // Toutes les variantes applicables doivent être des `options` : si l'une ne
    // borne pas ses valeurs, rien ne dit que celle-ci est fautive.
    const allowed =
      lists.length === applicable.length && lists.length > 0 ? [...new Set(lists.flat())] : undefined;
    if (allowed && !isExpression(value) && value !== undefined && !allowed.includes(value)) {
      findings.push({
        severity: SEVERITY,
        code: 'node-unknown-value',
        nodeName: node.name,
        message:
          `Paramètre « ${name} » : la valeur « ${String(value)} » n'est pas proposée par ` +
          `${schema.displayName ?? node.type}. Valeurs admises : ${allowed.map(String).join(', ')}.`,
        data: { param: name, value, allowed, nodeType: node.type, source: schema.source },
      });
    }
  }

  return findings;
}
