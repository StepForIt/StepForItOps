import { AppLogEntry, AppLogLevel, AppLogQuery, filterAppLogs, redactSecrets } from '@nwm/core';

/**
 * Les dernières lignes de log du process, en mémoire.
 *
 * En mémoire et nulle part ailleurs, volontairement : une ligne de log par
 * requête HTTP écrite en base, ce sont des millions de lignes par mois pour une
 * donnée qu'on relit pendant dix minutes après un incident. Le prix est dit à
 * l'écran — un redémarrage vide le tampon, et un process ne voit que ses propres
 * lignes —, parce qu'un journal qu'on croit complet est pire qu'un journal absent.
 *
 * La sortie du conteneur reste la source longue durée : le tampon la DOUBLE, il
 * ne la remplace pas.
 */
const DEFAULT_CAPACITY = 2_000;
/** Au-delà, une pile n'apprend plus rien et pèse autant que dix lignes. */
const MAX_STACK_CHARS = 4_000;

function capacityFromEnv(): number {
  const raw = Number(process.env.APP_LOG_BUFFER);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_CAPACITY;
}

export class LogBuffer {
  private readonly entries: AppLogEntry[] = [];
  private seq = 0;
  /** Lignes écartées depuis le démarrage : l'écran doit pouvoir dire qu'il ne montre pas tout. */
  private dropped = 0;

  constructor(private readonly capacity: number = capacityFromEnv()) {}

  push(level: AppLogLevel, context: string, message: string): void {
    this.seq += 1;
    this.entries.push({
      seq: this.seq,
      at: new Date().toISOString(),
      level,
      context,
      // Un log lu à l'écran est lu par plus de monde qu'un `docker logs` : le
      // masquage est celui du reste de la plateforme, une seule définition d'un
      // secret pour tout le monde.
      message: redactSecrets(message),
    });
    while (this.entries.length > this.capacity) {
      this.entries.shift();
      this.dropped += 1;
    }
  }

  /**
   * Rattache une pile à la dernière ligne posée (Nest l'imprime juste après le
   * message de l'erreur, en deux temps). Sans ce raccrochage, la pile ferait une
   * ligne de journal à elle seule, orpheline du message qu'elle explique.
   */
  attachStack(stack: string): void {
    const last = this.entries[this.entries.length - 1];
    if (!last || last.stack) return;
    last.stack = redactSecrets(stack.slice(0, MAX_STACK_CHARS));
  }

  query(query: AppLogQuery = {}): AppLogEntry[] {
    return filterAppLogs(this.entries, query);
  }

  /** Contextes présents dans le tampon, pour le filtre de l'écran. */
  contexts(): string[] {
    return [...new Set(this.entries.map((entry) => entry.context))].sort((a, b) => a.localeCompare(b));
  }

  stats(): { held: number; capacity: number; dropped: number; lastSeq: number } {
    return { held: this.entries.length, capacity: this.capacity, dropped: this.dropped, lastSeq: this.seq };
  }

  /**
   * Vide le tampon. Le rang, lui, continue de courir : le remettre à zéro ferait
   * croire à un écran ouvert que rien n'est arrivé depuis son curseur.
   */
  clear(): void {
    this.entries.length = 0;
    this.dropped = 0;
  }
}

/**
 * Instance unique du process, et non un simple provider Nest : le logger est
 * posé AVANT que l'injection de dépendances n'existe (NestFactory.create le
 * reçoit en option), sans quoi tout le démarrage — le moment qu'on veut
 * justement relire quand l'api ne monte pas — n'aurait laissé aucune trace.
 */
export const logBuffer = new LogBuffer();
