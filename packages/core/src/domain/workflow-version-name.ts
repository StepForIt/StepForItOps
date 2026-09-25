import { ARCHIVED_PREFIX, withoutArchivedPrefix } from './workflow-archive';
import { parseSemver } from './semver';
import { DEFAULT_ENV_IDS } from './env';
import { withoutEnvSuffix } from './workflow-env';

/**
 * Le numéro de version que l'équipe tient dans le NOM du workflow — « Facturation
 * (1.2.1) », « Facturation [1.2.1] », « Facturation v1.2.1 ». C'est le seul numéro
 * que n8n sache montrer, donc le seul que l'équipe voie ; l'ignorer faisait proposer
 * 1.0.0 à côté d'un 1.2.1, et faisait de « (1.1.4) » et « (1.2.1) » deux workflows
 * étrangers l'un à l'autre.
 *
 * Trois formes reconnues et pas une de plus : un nombre nu en fin de nom
 * (« Import CSV 1.2.1 ») est trop souvent autre chose qu'une version.
 */
const MARKER = /\s*(?:\(\s*v?(\d+\.\d+\.\d+)\s*\)|\[\s*v?(\d+\.\d+\.\d+)\s*\]|v(\d+\.\d+\.\d+))\s*$/i;

/** Nom décomposé : préfixe d'archivage, corps, suffixe d'env — le marqueur vit dans le corps. */
function split(
  name: string,
  envs: readonly string[] = DEFAULT_ENV_IDS,
): { archived: boolean; base: string; env: string } {
  const archived = name !== withoutArchivedPrefix(name);
  const rest = withoutArchivedPrefix(name).trim();
  const base = withoutEnvSuffix(rest, envs);
  // `withoutEnvSuffix` ne coupe qu'à la fin : le reste est le suffixe, verbatim.
  if (!base) return { archived, base: rest, env: '' };
  return { archived, base, env: rest.slice(base.length) };
}

/** « Facturation (1.2.1) - PROD » → « 1.2.1 ». Null quand le nom ne porte pas de numéro. */
export function versionFromName(name: string, envs: readonly string[] = DEFAULT_ENV_IDS): string | null {
  const match = MARKER.exec(split(name, envs).base);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3];
}

/** « Facturation (1.2.1) » → « Facturation » : ce qui apparie les exemplaires d'un env à l'autre. */
export function withoutVersionMarker(name: string): string {
  const match = MARKER.exec(name);
  return match ? name.slice(0, match.index).trim() || name : name;
}

/**
 * Reporte un numéro dans le nom, à la place et dans la forme du marqueur existant
 * — « Facturation (1.2.1) - PROD » + 1.2.2 → « Facturation (1.2.2) - PROD ».
 *
 * Un nom SANS marqueur est rendu tel quel : la plateforme tient le numéro dans sa
 * colonne, et n'a pas à imposer sa notation à qui ne l'a pas choisie.
 */
export function renameWithVersion(
  name: string,
  version: string,
  envs: readonly string[] = DEFAULT_ENV_IDS,
): string {
  if (!parseSemver(version)) return name;
  const { archived, base, env } = split(name, envs);
  const match = MARKER.exec(base);
  if (!match) return name;
  const current = match[1] ?? match[2] ?? match[3];
  const marker = match[0].replace(current, version);
  return `${archived ? ARCHIVED_PREFIX : ''}${base.slice(0, match.index)}${marker}${env}`;
}
