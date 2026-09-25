/**
 * Ce que l'API Make rend d'un scénario, et sa traduction vers le miroir.
 *
 * Pur : aucun appel réseau. L'adapter appelle, ce fichier décide de ce que ça
 * veut dire — et c'est ici qu'on teste, puisqu'un compte Make n'est pas une
 * dépendance de test acceptable.
 */
import { PlatformWorkflow, PlatformWorkflowSummary } from '../../ports/workflow-platform.port';
import { isMakeBlueprint } from './blueprint';

/** Un scénario tel que rend `GET /scenarios`. Partiel : on ne type que ce qu'on lit. */
export interface MakeScenario {
  id: number;
  name: string;
  isActive?: boolean;
  isPaused?: boolean;
  islocked?: boolean;
  /** Make se déclare cassé lui-même : une connexion manquante ⇒ refus d'activer. */
  isinvalid?: boolean;
  /** Jamais activé depuis sa création — un brouillon, pas un workflow en service. */
  concept?: boolean;
  folderId?: number | null;
  /** Chemin lisible du dossier, ex. `CRM/cleanup`. */
  folderPath?: string | null;
  scheduling?: { type?: string; interval?: number };
  lastEdit?: string;
  /** Nombre d'exécutions incomplètes non résolues (la file de rattrapage de Make). */
  dlqCount?: number;
  usedPackages?: string[];
  usedModules?: Array<{ packageName?: string; moduleName?: string }>;
}

/** `GET /scenarios/{id}/blueprint`. Le contenu vit deux niveaux plus bas. */
export interface MakeBlueprintResponse {
  code?: string;
  response?: { blueprint?: unknown };
}

/**
 * Les étiquettes d'un scénario. Make n'a pas de tags libres posés sur le
 * scénario comme n8n : il a des LABELS (une entité à part, `/scenario-labels`)
 * et une arborescence de DOSSIERS. Les deux disent l'appartenance, et le miroir
 * les rabat sur ses `tags` — c'est ce que la plateforme sait filtrer.
 *
 * Le dossier est rendu tel quel (`CRM/cleanup`), sans préfixe inventé : un
 * marqueur ajouté ici deviendrait un tag que personne n'a posé, et les règles
 * d'env (`env:<id>`) doivent pouvoir se poser à la main sur un label Make.
 */
export function scenarioTags(scenario: MakeScenario, labels: string[] = []): string[] {
  const tags = [...labels];
  if (scenario.folderPath) tags.push(scenario.folderPath);
  return tags.filter((tag, i) => tag.length > 0 && tags.indexOf(tag) === i);
}

/**
 * Un scénario devient une ligne du miroir.
 *
 * `archivedUpstream` reste FAUX quoi qu'il arrive : Make n'archive pas, il met à
 * la corbeille (30 jours), et un scénario en corbeille ne ressort pas du listing.
 * Un scénario en pause ou jamais activé n'est pas « archivé » — c'est un
 * workflow qu'on n'a pas allumé, et le confondre avec un workflow rangé le
 * ferait disparaître de toutes les vues par le filtre des archivés.
 */
export function toWorkflowSummary(scenario: MakeScenario, labels: string[] = []): PlatformWorkflowSummary {
  return {
    externalId: String(scenario.id),
    name: scenario.name,
    active: scenario.isActive === true && scenario.isPaused !== true,
    tags: scenarioTags(scenario, labels),
    archivedUpstream: false,
    changedAt: scenario.lastEdit,
  };
}

export function toWorkflow(
  scenario: MakeScenario,
  blueprint: unknown,
  labels: string[] = [],
): PlatformWorkflow {
  return { ...toWorkflowSummary(scenario, labels), raw: blueprint };
}

/**
 * Le contenu, extrait de l'enveloppe `{ code, response: { blueprint } }`.
 *
 * Une enveloppe vide n'est PAS un blueprint vide : c'est une réponse qu'on n'a
 * pas su lire, et la rendre comme un contenu ferait écraser en base la dernière
 * sauvegarde valable par du néant. On lève plutôt.
 */
export function readBlueprint(response: MakeBlueprintResponse): unknown {
  const blueprint = response?.response?.blueprint;
  if (blueprint === undefined || blueprint === null) {
    throw new Error("Réponse de blueprint Make illisible : aucun 'response.blueprint'.");
  }
  return blueprint;
}

/**
 * Les modules employés par un scénario, sans avoir à télécharger son blueprint —
 * `GET /scenarios` les donne. C'est ce que n8n ne sait pas faire, et ça vaut
 * pour l'inventaire d'un parc entier en un appel.
 */
export function usedModuleTypes(scenario: MakeScenario): string[] {
  return (scenario.usedModules ?? [])
    .map((m) => [m.packageName, m.moduleName].filter(Boolean).join(':'))
    .filter((name) => name.length > 0);
}

/** Le corps de `PATCH /scenarios/{id}` qui remplace le contenu d'un scénario. */
export interface MakeScenarioUpdate {
  /** Sérialisé : l'API attend le blueprint en chaîne, pas en objet. */
  blueprint: string;
  name?: string;
}

/**
 * Un blueprint devient le corps d'une mise à jour.
 *
 * Refuse ce qui n'est pas un blueprint : Make accepterait peut-être la chaîne, et
 * le scénario d'un client se retrouverait vidé par une version illisible. Le nom
 * part avec le contenu parce que Make le range HORS du blueprint — l'omettre
 * restaurerait les modules sous le nom d'aujourd'hui, là où n8n remet l'ancien.
 * Le planning n'y est pas : il vit dans un champ à part, et la version n'en a
 * jamais gardé trace.
 */
export function toScenarioUpdate(blueprint: unknown): MakeScenarioUpdate {
  if (!isMakeBlueprint(blueprint)) {
    throw new Error("Contenu illisible comme blueprint Make (aucun 'flow') : rien n'est écrit.");
  }
  const name = typeof blueprint.name === 'string' && blueprint.name.trim() ? blueprint.name : undefined;
  return { blueprint: JSON.stringify(blueprint), ...(name ? { name } : {}) };
}
