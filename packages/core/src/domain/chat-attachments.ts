/**
 * Pièces jointes d'un message du chat — captures d'écran d'abord, fichiers texte
 * ensuite (le second bloc de ce fichier) : une capture d'écran n8n (nœud en erreur,
 * panneau d'exécution) dit en une fois ce qu'une description approximative ne
 * transmet jamais. Le domaine tient ici les seules règles qui comptent — ce que
 * le modèle sait lire, et ce qu'on accepte de stocker — pour que l'API et l'UI
 * refusent la même chose, au même moment, avec le même message.
 */

import { Locale, currentLocale, msg, msgIn } from '../i18n';

/** Formats acceptés par l'API Anthropic. Un autre type n'est pas « dégradé » : il est refusé. */
export const CHAT_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export type ChatImageMediaType = (typeof CHAT_IMAGE_MEDIA_TYPES)[number];

/**
 * Poids maximal d'une image, mesuré sur les octets décodés. 5 Mo est la borne de
 * l'API Anthropic ; au-delà l'appel échoue APRÈS l'attente, ce qui ressemble à
 * une panne alors que c'est un refus prévisible.
 */
export const CHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Images par message. Au-delà, le contexte se dilue et chaque tour se paie en tokens. */
export const CHAT_IMAGE_MAX_PER_MESSAGE = 4;

/**
 * Images rejouées au modèle sur l'ensemble de l'historique. Une conversation qui
 * a vu six captures les renverrait toutes à chaque tour : le coût est linéaire en
 * tours, pour des captures dont seules les dernières sont encore en discussion.
 */
export const CHAT_IMAGE_HISTORY_LIMIT = 4;

export interface ChatImage {
  mediaType: ChatImageMediaType;
  /** Contenu en base64, sans préfixe `data:`. */
  data: string;
  /** Taille des octets décodés, pour l'affichage et les compteurs. */
  size: number;
}

export class ChatImageError extends Error {}

function isMediaType(value: string): value is ChatImageMediaType {
  return (CHAT_IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}

/** Taille des octets décodés, sans allouer le buffer (une capture pèse plusieurs Mo). */
function decodedSize(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export interface ChatImageInput {
  /** `image/png`, ou une data-URL complète collée telle quelle par le navigateur. */
  mediaType?: string;
  data?: string;
}

/**
 * Valide une image reçue du front. Accepte aussi bien `{mediaType, data}` qu'une
 * data-URL dans `data` : le presse-papier du navigateur produit la seconde forme,
 * et la faire démonter par l'UI seule laisserait l'API croire n'importe quoi.
 */
export function parseChatImage(input: ChatImageInput): ChatImage {
  const raw = (input?.data ?? '').trim();
  if (!raw) throw new ChatImageError(msg('chat.imageEmpty'));

  let mediaType = (input?.mediaType ?? '').trim().toLowerCase();
  let data = raw;
  const dataUrl = /^data:([^;,]+);base64,(.*)$/is.exec(raw);
  if (dataUrl) {
    mediaType = dataUrl[1].trim().toLowerCase();
    data = dataUrl[2];
  }
  data = data.replace(/\s+/g, '');

  if (!isMediaType(mediaType)) {
    throw new ChatImageError(
      msg('chat.imageUnsupported', {
        hasType: Boolean(mediaType),
        mediaType,
        accepted: CHAT_IMAGE_MEDIA_TYPES.join(', '),
      }),
    );
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new ChatImageError(msg('chat.imageUnreadable'));

  const size = decodedSize(data);
  if (size <= 0) throw new ChatImageError(msg('chat.imageEmpty'));
  if (size > CHAT_IMAGE_MAX_BYTES) {
    throw new ChatImageError(
      msg('chat.imageTooLarge', { size: formatBytes(size), max: formatBytes(CHAT_IMAGE_MAX_BYTES) }),
    );
  }
  return { mediaType, data, size };
}

/** Valide le lot joint à un message, en refusant d'abord le nombre : l'erreur est plus claire. */
export function parseChatImages(inputs: ChatImageInput[] | undefined): ChatImage[] {
  const list = inputs ?? [];
  if (list.length === 0) return [];
  if (list.length > CHAT_IMAGE_MAX_PER_MESSAGE) {
    throw new ChatImageError(msg('chat.imageTooMany', { max: CHAT_IMAGE_MAX_PER_MESSAGE }));
  }
  return list.map(parseChatImage);
}

/** Poids lisible, dans la langue de l'écran par défaut (`o`/`ko`/`Mo` en français). */
export function formatBytes(size: number, locale: Locale = currentLocale()): string {
  if (size < 1024) return msgIn(locale, 'chat.sizeB', { n: String(size) });
  if (size < 1024 * 1024) return msgIn(locale, 'chat.sizeKb', { n: String(Math.round(size / 1024)) });
  return msgIn(locale, 'chat.sizeMb', { n: (size / (1024 * 1024)).toFixed(1) });
}

/**
 * Ne garde que les dernières images de l'historique, les plus récentes d'abord.
 * `messages` est du plus ancien au plus récent ; le résultat conserve cet ordre,
 * seules les images trop anciennes sont retirées.
 */
export function limitHistoryImages<T extends { images?: ChatImage[] }>(
  messages: T[],
  limit = CHAT_IMAGE_HISTORY_LIMIT,
): T[] {
  let budget = limit;
  const kept: boolean[][] = messages.map((message) => (message.images ?? []).map(() => false));
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const images = messages[index].images ?? [];
    for (let position = images.length - 1; position >= 0 && budget > 0; position -= 1) {
      kept[index][position] = true;
      budget -= 1;
    }
  }
  return messages.map((message, index) => {
    const images = (message.images ?? []).filter((_, position) => kept[index][position]);
    return images.length === (message.images ?? []).length ? message : { ...message, images };
  });
}

/* ------------------------------------------------------------------------- *
 * Fichiers texte joints                                                      *
 * ------------------------------------------------------------------------- */

/**
 * Une capture montre un écran ; un fichier PORTE la donnée — le JSON d'un
 * workflow exporté d'ailleurs, la réponse brute d'une API, le CSV qui plante à
 * la ligne 4012. Recopié dans la zone de saisie, il arrive tronqué ou reformaté ;
 * joint, il arrive tel quel, et la question tient en une phrase à côté.
 *
 * Rien de binaire ici : ce que le modèle lit est du texte, et un PDF ou un ZIP
 * déguisé en `.txt` est refusé plutôt que transmis en charabia.
 */

/** Extensions reconnues, avec le langage de coloration du bloc rendu au modèle. */
const TEXT_EXTENSIONS: Record<string, { mediaType: string; lang: string }> = {
  txt: { mediaType: 'text/plain', lang: '' },
  log: { mediaType: 'text/plain', lang: '' },
  md: { mediaType: 'text/markdown', lang: 'markdown' },
  markdown: { mediaType: 'text/markdown', lang: 'markdown' },
  json: { mediaType: 'application/json', lang: 'json' },
  csv: { mediaType: 'text/csv', lang: 'csv' },
  tsv: { mediaType: 'text/tab-separated-values', lang: '' },
  xml: { mediaType: 'application/xml', lang: 'xml' },
  html: { mediaType: 'text/plain', lang: 'html' },
  yml: { mediaType: 'application/yaml', lang: 'yaml' },
  yaml: { mediaType: 'application/yaml', lang: 'yaml' },
  sql: { mediaType: 'text/plain', lang: 'sql' },
  js: { mediaType: 'text/plain', lang: 'javascript' },
  ts: { mediaType: 'text/plain', lang: 'typescript' },
  py: { mediaType: 'text/plain', lang: 'python' },
  sh: { mediaType: 'text/plain', lang: 'bash' },
  ini: { mediaType: 'text/plain', lang: 'ini' },
  conf: { mediaType: 'text/plain', lang: '' },
  toml: { mediaType: 'text/plain', lang: 'toml' },
};

export const CHAT_FILE_EXTENSIONS = Object.keys(TEXT_EXTENSIONS);

/**
 * Poids d'un fichier joint, mesuré sur son texte. 256 ko, soit l'ordre de
 * grandeur d'un gros workflow n8n exporté : au-delà, le fichier ne se lit plus,
 * il se cherche — et il se paie en tokens à chaque tour de la conversation.
 */
export const CHAT_FILE_MAX_BYTES = 256 * 1024;

/** Fichiers par message. Plus haut que les images : comparer deux exports est le cas courant. */
export const CHAT_FILE_MAX_PER_MESSAGE = 5;

/**
 * Budget de texte rejoué sur l'ENSEMBLE de l'historique. Les fichiers d'un tour
 * ancien ne sont pas rejoués éternellement : on garde les plus récents dans cette
 * limite, et les autres restent MENTIONNÉS par leur nom — le modèle sait alors
 * qu'un fichier existait et peut le redemander, au lieu de répondre comme si
 * l'utilisateur n'en avait jamais joint.
 */
export const CHAT_FILE_HISTORY_BYTES = 400 * 1024;

export interface ChatTextFile {
  name: string;
  mediaType: string;
  /** Contenu texte, tel qu'il sera rendu au modèle. Vide quand `dropped`. */
  text: string;
  /** Taille du texte en octets UTF-8, conservée même une fois le contenu écarté. */
  size: number;
  /** Écarté du rejeu par le budget d'historique : seul son nom part au modèle. */
  dropped?: boolean;
}

export class ChatFileError extends Error {}

export interface ChatFileInput {
  name?: string;
  mediaType?: string;
  /** Contenu texte brut (le navigateur lit le fichier, il n'a rien à encoder). */
  text?: string;
}

function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Du binaire renommé en `.txt` arrive ici en caractères de contrôle et en
 * U+FFFD, ce que produit un décodage UTF-8 raté. On le refuse : transmis, il
 * remplit le contexte d'un bruit que le modèle commentera sérieusement.
 */
function looksBinary(text: string): boolean {
  if (text.includes('\u0000')) return true;
  const sample = text.slice(0, 4096);
  // Les caractères de contrôle sont précisément ce qu'on traque : c'est leur
  // présence qui trahit un binaire déguisé en texte.
  // eslint-disable-next-line no-control-regex
  const suspicious = (sample.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g) ?? []).length;
  return suspicious > sample.length * 0.02;
}

/**
 * Longueur en octets UTF-8, comptée à la main : le domaine ne connaît ni Node
 * (`Buffer`) ni le navigateur (`TextEncoder`), et c'est cette taille-là qui sera
 * stockée puis réaffichée.
 */
function utf8Size(text: string): number {
  let size = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    size += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return size;
}

export function parseChatFile(input: ChatFileInput): ChatTextFile {
  const name = (input?.name ?? '').trim().split(/[\\/]/).pop()?.slice(0, 120) || 'fichier.txt';
  const text = input?.text ?? '';
  if (!text.trim()) throw new ChatFileError(msg('chat.fileEmpty', { name }));

  const extension = extensionOf(name);
  const known = TEXT_EXTENSIONS[extension];
  const declared = (input?.mediaType ?? '').trim().toLowerCase().split(';')[0];
  if (!known && !declared.startsWith('text/')) {
    throw new ChatFileError(msg('chat.fileUnsupported', { name, accepted: CHAT_FILE_EXTENSIONS.join(', ') }));
  }
  if (looksBinary(text)) throw new ChatFileError(msg('chat.fileBinary', { name }));

  const size = utf8Size(text);
  if (size > CHAT_FILE_MAX_BYTES) {
    throw new ChatFileError(
      msg('chat.fileTooLarge', { name, size: formatBytes(size), max: formatBytes(CHAT_FILE_MAX_BYTES) }),
    );
  }
  return { name, mediaType: known?.mediaType ?? 'text/plain', text, size };
}

/** Valide le lot joint à un message, nombre d'abord puis poids cumulé. */
export function parseChatFiles(inputs: ChatFileInput[] | undefined): ChatTextFile[] {
  const list = inputs ?? [];
  if (list.length === 0) return [];
  if (list.length > CHAT_FILE_MAX_PER_MESSAGE) {
    throw new ChatFileError(msg('chat.fileTooMany', { max: CHAT_FILE_MAX_PER_MESSAGE }));
  }
  const files = list.map(parseChatFile);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > CHAT_FILE_HISTORY_BYTES) {
    throw new ChatFileError(
      msg('chat.filesTooLargeTotal', { size: formatBytes(total), max: formatBytes(CHAT_FILE_HISTORY_BYTES) }),
    );
  }
  return files;
}

/** Clôture assez longue pour que le contenu ne referme pas le bloc par accident. */
function fenceFor(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function langOf(name: string): string {
  return TEXT_EXTENSIONS[extensionOf(name)]?.lang ?? '';
}

/**
 * Le message tel que le modèle le reçoit : le texte de l'utilisateur d'abord —
 * c'est SA question qui commande —, puis chaque fichier dans son bloc nommé.
 * Coller le contenu à même la question ferait passer un CSV de 3 000 lignes pour
 * la demande elle-même.
 */
export function renderChatFiles(content: string, files: ChatTextFile[]): string {
  if (files.length === 0) return content;
  const blocks = files.map((file) => {
    const head = `--- Attached file: ${file.name} (${formatBytes(file.size, 'en')}) ---`;
    if (file.dropped) {
      return `${head}\n(content not replayed in this turn — ask for it if you need it)`;
    }
    const fence = fenceFor(file.text);
    return `${head}\n${fence}${langOf(file.name)}\n${file.text}\n${fence}`;
  });
  return [content.trim(), ...blocks].filter(Boolean).join('\n\n');
}

/**
 * Ne rejoue que les derniers fichiers de l'historique, dans la limite du budget.
 * Les autres sont conservés — leur NOM reste visible du modèle — mais vidés de
 * leur contenu : `messages` va du plus ancien au plus récent, l'ordre est gardé.
 */
export function limitHistoryFiles<T extends { files?: ChatTextFile[] }>(
  messages: T[],
  budget = CHAT_FILE_HISTORY_BYTES,
): T[] {
  let left = budget;
  const kept: boolean[][] = messages.map((message) => (message.files ?? []).map(() => false));
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const files = messages[index].files ?? [];
    for (let position = files.length - 1; position >= 0; position -= 1) {
      if (files[position].size > left) continue;
      kept[index][position] = true;
      left -= files[position].size;
    }
  }
  return messages.map((message, index) => {
    const files = message.files ?? [];
    if (files.length === 0 || kept[index].every(Boolean)) return message;
    return {
      ...message,
      files: files.map((file, position) =>
        kept[index][position] ? file : { ...file, text: '', dropped: true },
      ),
    };
  });
}
