/**
 * Filtres anti-bruit des remarques IA. Une analyse qui remonte tout ne se lit plus :
 * les findings vrais se noient dans les remarques que rien n'oblige à traiter, et
 * l'utilisateur finit par ignorer la page entière — y compris les erreurs réelles.
 *
 * Deux familles de bruit, toutes deux invérifiables par un prompt seul :
 *  - le « codé en dur » qui vise en fait un placeholder assumé ;
 *  - ce que n8n normalise lui-même à l'exécution (forme du retour d'un nœud Code).
 */

/** Formes qu'un humain donne à un trou à remplir : `[productId]`, `{{ x }}`, `<id>`, `%TOKEN%`. */
const PLACEHOLDER_FORMS = [
  /\[[A-Za-z0-9_.\- ]{1,40}\]/, // [productId]
  /\{\{[^}]{1,80}\}\}/, // {{ $json.id }}
  /<[A-Za-z0-9_.\- ]{1,40}>/, // <id>
  /%[A-Za-z0-9_]{1,40}%/, // %TOKEN%
  /\$\{[^}]{1,80}\}/, // ${id}
  /\b(?:TODO|FIXME|XXX+|PLACEHOLDER|A_REMPLIR)\b/i,
];

/**
 * Le texte contient-il une valeur manifestement destinée à être remplacée ?
 * Un `[productId]` dans un corps JSON n'est pas une valeur codée en dur : c'est
 * un gabarit, et le signaler comme un oubli est un faux positif.
 */
export function looksLikePlaceholder(text: string): boolean {
  return PLACEHOLDER_FORMS.some((form) => form.test(text));
}

/** La remarque reproche-t-elle une valeur codée en dur ? */
const HARDCODED_CLAIM = /\b(?:en dur|cod(?:é|ee?|e)s? en dur|hard-?cod(?:e|é|ing|ed))\b/i;

/**
 * Remarques que n8n résout tout seul : le nœud Code accepte un objet nu, un tableau
 * d'objets ou la forme `[{json:{…}}]`, et enveloppe le reste à l'exécution. Le
 * signaler décrit du code qui marche.
 */
const N8N_NORMALIZED = [
  /format\s+(?:de\s+retour|attendu)/i,
  /\[\s*\{\s*json/i,
  /doit\s+(?:être|retourner)\s+un\s+tableau\s+d[’']items/i,
  /retour(?:ne|ner)?\s+(?:pas\s+)?(?:un\s+)?tableau\s+d[’']items/i,
];

/**
 * Remarque à écarter avant persistance. `quotedCode` est le fragment cité par
 * l'IA quand elle en fournit un : c'est lui qui départage un vrai secret codé
 * en dur d'un gabarit.
 */
export function isNoisyAiFinding(message: string, quotedCode?: string | null): boolean {
  if (N8N_NORMALIZED.some((pattern) => pattern.test(message))) return true;
  if (HARDCODED_CLAIM.test(message) && looksLikePlaceholder(quotedCode ?? message)) return true;
  return false;
}
