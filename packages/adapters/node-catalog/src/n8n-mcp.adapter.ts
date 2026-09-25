import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CatalogNodeType, CatalogRevision, NodeCatalogPort, NodeProperty, toLongNodeType } from '@nwm/core';

/**
 * Catalogue des types de nœuds, alimenté par le projet n8n-mcp.
 *
 * Pourquoi celui-là : n8n ne publie nulle part la description de ses nœuds sous
 * une forme consommable. Elle vit dans le code des nœuds, et n'est servie que par
 * une instance en marche, derrière une session navigateur. n8n-mcp (MIT) fait ce
 * travail d'extraction en continu et versionne le résultat dans un SQLite —
 * 832 nœuds cœur, 829 avec leur schéma de paramètres complet.
 *
 * Ce que cet adapter ne fait PAS : servir le catalogue. Il ne sert qu'à
 * l'importer. Une fois les types en base chez nous, la plateforme n'a plus besoin
 * de lui — c'est la condition posée d'entrée de jeu : le catalogue doit survivre
 * à la disparition de sa source amont.
 *
 * Les nœuds communautaires (1 784 sur 2 616) sont écartés par défaut : ils pèsent
 * l'essentiel du fichier, README npm compris, pour des intégrations que
 * l'instance n'a probablement pas installées. Ceux qu'elle a vraiment, la
 * synchronisation par instance (phase 2) les lit à la source.
 */

const OWNER = 'czlonkowski';
const REPO = 'n8n-mcp';
const DB_PATH = 'data/nodes.db';

const CONTENTS_URL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${DB_PATH}`;
const RAW_URL = `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${DB_PATH}`;
const RELEASE_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

/** Le téléchargement pèse ~100 Mo : sans plafond, un amont muet bloque le cron. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const METADATA_TIMEOUT_MS = 20 * 1000;

async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'nwm-node-catalog' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${url} → ${response.status} ${await response.text().catch(() => '')}`.slice(0, 300));
  }
  return (await response.json()) as T;
}

/** JSON d'une colonne, ou `fallback` : une ligne illisible ne doit pas tuer l'import entier. */
function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * `version` amont est une chaîne (« 4.5 », « 1 »). On la ramène à un nombre pour
 * la comparer à la `typeVersion` d'un nœud, et `undefined` si elle ne s'y prête
 * pas — un contrôle qui compare à NaN se tairait sans qu'on sache pourquoi.
 */
function parseVersion(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface CatalogRow {
  node_type: string;
  package_name: string | null;
  display_name: string | null;
  description: string | null;
  version: string | null;
  is_trigger: number;
  is_webhook: number;
  is_versioned: number;
  properties_schema: string | null;
  operations: string | null;
  credentials_required: string | null;
  documentation: string | null;
}

export class N8nMcpCatalogAdapter implements NodeCatalogPort {
  readonly sourceName = 'n8n-mcp';

  /**
   * Version amont, lue SANS télécharger les 100 Mo : le sha du blob suffit à
   * savoir s'il y a du neuf, et c'est ce qui permet au cron hebdomadaire de ne
   * rien faire la plupart du temps.
   */
  async revision(): Promise<CatalogRevision> {
    const blob = await getJson<{ sha?: string }>(CONTENTS_URL, METADATA_TIMEOUT_MS);
    if (!blob.sha) throw new Error(`Aucun sha rendu pour ${DB_PATH}`);
    // La version de n8n décrite est annoncée par la release, jamais par le blob.
    // Renseignement de confort : son absence n'empêche pas la synchronisation.
    const n8nVersion = await getJson<{ tag_name?: string }>(RELEASE_URL, METADATA_TIMEOUT_MS)
      .then((release) => release.tag_name)
      .catch(() => undefined);
    return { revision: blob.sha, n8nVersion };
  }

  async fetch(options: { includeCommunity?: boolean } = {}): Promise<CatalogNodeType[]> {
    const directory = await mkdtemp(join(tmpdir(), 'nwm-node-catalog-'));
    const file = join(directory, 'nodes.db');
    try {
      await download(file);
      return await read(file, options.includeCommunity === true);
    } finally {
      // Le fichier est un intermédiaire, pas un cache : le garder ferait grossir
      // le conteneur de 100 Mo à chaque synchronisation.
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function download(file: string): Promise<void> {
  const response = await fetch(RAW_URL, {
    headers: { 'User-Agent': 'nwm-node-catalog' },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Téléchargement du catalogue → ${response.status}`);
  }
  // En flux vers le disque, et non en mémoire : 100 Mo d'un coup dans le tas de
  // l'api, c'est le conteneur web qui s'est déjà fait tuer pour moins que ça.
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(file));
}

async function read(file: string, includeCommunity: boolean): Promise<CatalogNodeType[]> {
  // Import dynamique : `node:sqlite` n'existe qu'à partir de Node 22, et un
  // échec doit se lire comme un problème de plateforme, pas comme un module
  // introuvable au démarrage de l'api.
  let DatabaseSync: new (
    path: string,
    options?: { readOnly?: boolean },
  ) => {
    prepare(sql: string): { all(...params: unknown[]): unknown[] };
    close(): void;
  };
  try {
    ({ DatabaseSync } = (await import('node:sqlite')) as never);
  } catch {
    throw new Error(
      'Lecture du catalogue impossible : `node:sqlite` demande Node 22 ou plus. ' +
        "L'image de l'api doit être bâtie sur node:22-alpine.",
    );
  }

  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `select node_type, package_name, display_name, description, version,
                is_trigger, is_webhook, is_versioned,
                properties_schema, operations, credentials_required, documentation
           from nodes
          where properties_schema is not null and properties_schema not in ('', '[]')
            ${includeCommunity ? '' : 'and is_community = 0'}`,
      )
      .all() as unknown as CatalogRow[];

    return rows.map((row) => ({
      // Forme longue dès l'entrée : plus rien en aval n'a à connaître la
      // convention de nommage de l'amont.
      nodeType: toLongNodeType(row.node_type),
      packageName: row.package_name ?? '',
      displayName: row.display_name ?? row.node_type,
      description: row.description ?? undefined,
      version: parseVersion(row.version),
      isTrigger: row.is_trigger === 1,
      isWebhook: row.is_webhook === 1,
      isVersioned: row.is_versioned === 1,
      properties: parseJson<NodeProperty[]>(row.properties_schema, []),
      operations: parseJson<unknown>(row.operations, undefined),
      credentialsRequired: parseJson<unknown>(row.credentials_required, undefined),
      documentation: row.documentation ?? undefined,
    }));
  } finally {
    db.close();
  }
}
