import { ChatImage } from '../domain/chat-attachments';

/**
 * Profondeur de raisonnement du modèle. C'est le premier levier de latence :
 * les modèles récents réfléchissent par défaut au niveau `high`, ce qui coûte
 * des dizaines de secondes et consomme le budget de `maxTokens`. Une analyse
 * de masse (extraction, pré-tri de findings) tourne très bien en `low`.
 */
export type AiEffort = 'low' | 'medium' | 'high';

export interface AiGenerateParams {
  system?: string;
  prompt: string;
  maxTokens?: number;
  effort?: AiEffort;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  /**
   * Images jointes au message (captures d'écran). Un adapter qui ne sait pas les
   * lire doit le dire, jamais les ignorer en silence : la question porte dessus.
   */
  images?: ChatImage[];
}

export interface AiChatParams {
  system?: string;
  /** Historique complet, du plus ancien au plus récent ; doit finir par un message `user`. */
  messages: AiMessage[];
  maxTokens?: number;
  effort?: AiEffort;
}

/**
 * Outil mis à disposition du modèle. `input` est un JSON Schema : c'est le
 * contrat que le modèle remplit, et la seule description que l'outil ait.
 */
export interface AiTool {
  name: string;
  description: string;
  input: Record<string, unknown>;
  /** Exécute l'outil et renvoie ce que le modèle lira. Une erreur devient un résultat d'erreur. */
  run(input: Record<string, unknown>): Promise<string>;
}

export interface AiToolTrace {
  name: string;
  input: Record<string, unknown>;
  result: string;
  failed: boolean;
}

export interface AiAgentParams extends AiChatParams {
  tools: AiTool[];
  /**
   * Nombre d'allers-retours d'outils avant abandon. La borne est volontaire :
   * un modèle qui boucle sur un outil coûte un appel par tour, sans fin.
   */
  maxRounds?: number;
  /**
   * Demande le RÉSUMÉ du raisonnement du modèle. Sur les modèles courants, le
   * raisonnement a lieu de toute façon et est facturé de toute façon — seul son
   * renvoi est optionnel, et il est omis par défaut. On ne le demande donc que
   * là où quelqu'un va le lire : la chaîne de pensée brute, elle, n'est jamais
   * exposée par l'API, quel que soit ce réglage.
   */
  showThinking?: boolean;
  /**
   * Appelé au fil de la boucle, avant chaque attente. C'est la SEULE façon de
   * savoir qu'un tour avance : l'appel est bloquant, et sa trace n'arrive
   * qu'avec la réponse — trop tard pour qui attend devant l'écran. Ce que
   * l'appelant en fait ne regarde pas l'adapter, et une erreur levée là ne doit
   * jamais interrompre le tour.
   */
  onProgress?(event: AiAgentEvent): void;
  /**
   * Arrête le tour en cours. Un tour dure des dizaines de secondes derrière un
   * appel bloquant : sans ce signal, une demande mal formulée se paie jusqu'au
   * bout, et l'attente n'a d'autre issue que la réponse. L'abandon est vérifié
   * entre chaque aller-retour d'outil autant qu'il est transmis à l'API : un
   * outil qui vient de rendre la main relancerait sinon un appel complet.
   */
  signal?: AbortSignal;
}

/** Ce que la boucle d'outils traverse, dans l'ordre. */
export type AiAgentEvent =
  | { type: 'round'; round: number }
  | { type: 'tool'; name: string; input: Record<string, unknown> }
  | { type: 'tool-result'; name: string; failed: boolean };

/** Le raisonnement d'un tour, tel que l'API le résume. */
export interface AiThinkingStep {
  /** Tour de la boucle d'outils (0 = premier appel). */
  round: number;
  text: string;
}

export interface AiAgentResult {
  text: string;
  /** Ce que le modèle a réellement fait, dans l'ordre — pour le montrer à l'utilisateur. */
  trace: AiToolTrace[];
  /** Résumé de son raisonnement, tour par tour. Vide si `showThinking` n'a pas été demandé. */
  thinking: AiThinkingStep[];
}

/** Fournisseurs de modèles câblables. */
export const AI_PROVIDERS = ['anthropic', 'mistral'] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value);
}

export interface AiCredentials {
  apiKey: string;
  model?: string;
  /**
   * Fournisseur visé. Utile au seul test de credentials, qui porte sur les
   * valeurs d'un formulaire et non sur le fournisseur actif.
   */
  provider?: AiProvider;
}

/**
 * Résout les credentials effectifs à CHAQUE appel (réglages DB, variables d'env).
 * Résoudre une fois pour toutes obligerait à redémarrer l'API après un changement
 * de clé ou de fournisseur.
 */
export type AiCredentialsProvider = () => Promise<AiCredentials | null>;

export interface AiPort {
  generate(params: AiGenerateParams): Promise<string>;
  /** Génère un JSON (le prompt doit décrire le schéma attendu) et le parse. */
  generateJson<T>(params: AiGenerateParams): Promise<T>;
  /** Conversation multi-tours : renvoie la réponse texte de l'assistant. */
  chat(params: AiChatParams): Promise<string>;
  /**
   * Conversation où le modèle peut appeler des outils avant de répondre :
   * l'adapter déroule la boucle (appel → outil → appel) et rend le texte final.
   */
  chatWithTools(params: AiAgentParams): Promise<AiAgentResult>;
  /** L'adapter est-il configuré (clé API présente en DB ou en env) ? */
  isConfigured(): Promise<boolean>;
  /** Teste des credentials (fournis, sinon les credentials effectifs) par un appel minimal. */
  testCredentials(credentials?: AiCredentials): Promise<void>;
}

export const AI_PORT = Symbol('AI_PORT');

/**
 * La boucle d'outils s'est arrêtée sans réponse finale. L'erreur porte ce que le
 * modèle avait DÉJÀ fait : sans elle, un tour qui a lu trois nœuds et vérifié un
 * brouillon ne laisse qu'un message d'échec — la trace disparaît des logs, et le
 * brouillon déjà contrôlé se perd avec elle.
 */
export class AiToolLoopError extends Error {
  constructor(
    readonly rounds: number,
    readonly trace: AiToolTrace[],
    readonly thinking: AiThinkingStep[],
  ) {
    super(
      `Boucle d'outils interrompue après ${rounds} tours sans réponse finale${
        trace.length > 0 ? ` (${summarizeToolTrace(trace)})` : ''
      }`,
    );
    this.name = 'AiToolLoopError';
  }
}

/** Les outils appelés, comptés par nom : c'est ce qui dit sur quoi la boucle a tourné. */
export function summarizeToolTrace(trace: AiToolTrace[]): string {
  const counts = new Map<string, number>();
  for (const step of trace) counts.set(step.name, (counts.get(step.name) ?? 0) + 1);
  return [...counts].map(([name, count]) => (count > 1 ? `${name}×${count}` : name)).join(', ');
}
