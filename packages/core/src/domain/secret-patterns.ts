/**
 * Reconnaître un secret dans des paramètres n8n, et le masquer.
 *
 * Deux usages, une seule définition de ce qu'est un secret : `reliability-checks`
 * le SIGNALE (« ce nœud porte une clé en clair »), `redactSecrets` le RETIRE
 * avant de montrer les paramètres d'un nœud qui appartient à un autre workflow.
 * Deux listes de motifs auraient divergé, et c'est celle de la redaction qui
 * aurait manqué au mauvais moment.
 */

/**
 * Secrets reconnaissables à leur forme seule, où qu'ils apparaissent.
 * Préfixes publics des providers (Anthropic, OpenAI, GitHub, Slack, AWS,
 * Google, GitLab) + JWT. Volontairement stricts : un raté ici est un faux
 * positif « secret en clair », le pire des cris au loup.
 */
export const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-ant-[\w-]{20,}/,
  /\bsk-[A-Za-z0-9]{32,}\b/,
  /\bghp_[A-Za-z0-9]{36}\b/,
  /\bgithub_pat_[\w]{22,}\b/,
  /\bxox[baprs]-[\w-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[\w-]{30,}/,
  /\bglpat-[\w-]{20,}/,
  /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/,
];

/** Noms de paramètres qui portent un secret quand leur valeur est littérale. */
export const SECRET_PARAM_NAMES =
  /^(authorization|api[_-]?key|apikey|x-api-key|token|access[_-]?token|auth[_-]?token|secret|client[_-]?secret|password|bearer)$/i;

/** Longueur minimale d'une valeur littérale pour être suspectée (écarte "test", "1234"). */
export const MIN_SECRET_LENGTH = 12;

/** Une valeur d'expression n8n ne contient jamais le secret : il vit dans le credential. */
export function isExpression(value: string): boolean {
  return value.includes('{{');
}

/** Valeur visiblement « à remplacer » (placeholder de doc), pas un vrai secret. */
export function isPlaceholder(value: string): boolean {
  return /your[_ -]|<[^>]+>|\bxxx+\b|\bchange ?me\b/i.test(value);
}

export function mask(value: string): string {
  return value.length <= 8 ? '…' : `${value.slice(0, 4)}…${value.slice(-2)}`;
}

/** Le secret d'une chaîne, s'il y en a un : la sous-chaîne fautive, pas la valeur entière. */
function secretIn(text: string, paramName?: string): string | null {
  if (isExpression(text) || isPlaceholder(text)) return null;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  if (paramName && SECRET_PARAM_NAMES.test(paramName)) {
    // « Bearer abc… » : c'est la partie après le schéma qui doit être longue.
    const bare = text.replace(/^(bearer|basic|token)\s+/i, '');
    if (bare.length >= MIN_SECRET_LENGTH && !/\s/.test(bare)) return bare;
  }
  return null;
}

/**
 * Copie d'un arbre de paramètres, secrets masqués.
 *
 * Sert à montrer à l'assistant comment un nœud est configuré AILLEURS : le
 * corpus est un modèle de montage, pas un trousseau. Un token laissé là serait
 * recopié tel quel dans une proposition, et sorti de son workflow d'origine par
 * la même occasion.
 *
 * Le masque garde la forme (une chaîne reste une chaîne, de longueur plausible) :
 * ce qui intéresse le lecteur est qu'un en-tête `Authorization` existe et où il
 * se pose, jamais sa valeur.
 */
export function redactSecrets<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown, keyName?: string): unknown {
  if (typeof value === 'string') {
    const found = secretIn(value, keyName);
    return found ? value.replace(found, `[secret masqué ${mask(found)}]`) : value;
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, keyName));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // Paire n8n { name, value } : le name est la clé de la valeur.
    if (typeof record.name === 'string' && typeof record.value === 'string') {
      return { ...record, value: walk(record.value, record.name) };
    }
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) out[key] = walk(child, key);
    return out;
  }
  return value;
}
