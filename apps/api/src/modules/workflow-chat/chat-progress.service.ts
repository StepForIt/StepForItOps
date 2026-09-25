import { Injectable } from '@nestjs/common';
import { TurnProgress, TurnProgressStep } from '@nwm/core';

/**
 * L'avancement du tour en cours, le temps qu'il dure.
 *
 * En mémoire et jamais en base : ça ne survit ni au tour ni au process, et c'est
 * voulu — un avancement conservé après coup se lirait comme un historique, alors
 * que ce qui reste d'un tour terminé, c'est sa trace d'outils (`toolTrace`),
 * elle-même persistée avec la réponse.
 *
 * Le front interroge cette route pendant qu'il attend la réponse : l'appel qui
 * produit le tour est bloquant, il ne peut rien dire avant de rendre la main.
 */
@Injectable()
export class ChatProgressService {
  private readonly turns = new Map<string, TurnProgress>();

  /** Ouvre un tour, en écrasant celui d'avant : un seul tour par conversation. */
  start(sessionId: string): void {
    this.turns.set(sessionId, { startedAt: new Date().toISOString(), steps: [], running: true });
  }

  /**
   * Ajoute une étape et clôt la précédente. Les étapes s'enchaînent, elles ne se
   * chevauchent pas : ce qu'on affiche est une liste, dont la dernière ligne est
   * celle qui tourne.
   */
  step(sessionId: string, step: TurnProgressStep): void {
    const turn = this.turns.get(sessionId);
    if (!turn) return;
    const last = turn.steps[turn.steps.length - 1];
    if (last) last.done = true;
    turn.steps.push(step);
  }

  /** Marque la dernière étape en échec, sans en ouvrir de nouvelle. */
  fail(sessionId: string): void {
    const last = this.turns.get(sessionId)?.steps.slice(-1)[0];
    if (last) {
      last.done = true;
      last.failed = true;
    }
  }

  /**
   * Ferme le tour. L'entrée n'est pas supprimée tout de suite : le front peut
   * interroger une dernière fois après coup, et une absence se lirait comme un
   * tour perdu.
   */
  finish(sessionId: string): void {
    const turn = this.turns.get(sessionId);
    if (!turn) return;
    const last = turn.steps[turn.steps.length - 1];
    if (last) last.done = true;
    turn.running = false;
    setTimeout(() => this.turns.delete(sessionId), 30_000).unref?.();
  }

  /** Ce qu'il y a à montrer, ou rien si aucun tour n'est passé par là. */
  read(sessionId: string): TurnProgress | null {
    return this.turns.get(sessionId) ?? null;
  }
}
