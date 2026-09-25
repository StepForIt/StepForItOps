import { Injectable } from '@nestjs/common';

/**
 * Le bouton « Stop » d'un tour en cours.
 *
 * Un tour dure des dizaines de secondes — relecture n8n, contexte, plusieurs
 * allers-retours d'outils — et rien ne permettait d'en sortir : une demande mal
 * formulée se payait jusqu'au bout, et la reformuler imposait d'attendre une
 * réponse dont on savait déjà qu'elle était à jeter.
 *
 * En mémoire et par process, comme l'avancement (`ChatProgressService`) : le
 * signal ne vaut que là où le tour tourne. Une demande d'arrêt qui n'y trouve
 * rien le DIT (`false`) au lieu de laisser croire à un arrêt — le tour continue
 * alors et répondra normalement, ce qui est la seule chose honnête à afficher.
 */
@Injectable()
export class ChatCancelService {
  private readonly running = new Map<string, AbortController>();

  /**
   * Ouvre un tour interruptible, en fermant celui d'avant : une conversation ne
   * porte qu'un tour à la fois.
   */
  open(sessionId: string): AbortSignal {
    this.running.get(sessionId)?.abort();
    const controller = new AbortController();
    this.running.set(sessionId, controller);
    return controller.signal;
  }

  /** Demande l'arrêt. `false` : aucun tour de cette conversation ne tourne ici. */
  cancel(sessionId: string): boolean {
    const controller = this.running.get(sessionId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /** Le tour a-t-il été interrompu ? Relu APRÈS l'erreur : plus sûr que de la renifler. */
  wasCancelled(sessionId: string): boolean {
    return this.running.get(sessionId)?.signal.aborted ?? false;
  }

  /** Referme le tour, qu'il ait abouti ou non. */
  close(sessionId: string): void {
    this.running.delete(sessionId);
  }
}
