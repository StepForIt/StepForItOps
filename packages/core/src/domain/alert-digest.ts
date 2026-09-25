/**
 * Regroupement des alertes répétitives.
 *
 * Un problème annoncé une fois n'a pas besoin d'un message par occurrence : les
 * suivantes sont comptées et ne ressortent qu'en récapitulatif de fenêtre
 * (« 5 nouvelles exécutions depuis 9 h 40 »). Sans mémoire de ce qui a déjà été
 * annoncé, un workflow qui casse toutes les minutes remplit le canal d'alertes
 * identiques — et le lecteur cesse de les lire.
 */

export interface DigestEntry<T> {
  /** Dernier événement vu : c'est lui qui libelle le récapitulatif. */
  payload: T;
  /** Occurrences accumulées depuis le dernier message envoyé. */
  count: number;
  /** Date du dernier message : le « depuis » du récapitulatif. */
  since: Date;
}

export interface DueDigest<T> extends DigestEntry<T> {
  key: string;
}

export class AlertDigestBuffer<T> {
  private readonly entries = new Map<string, DigestEntry<T>>();

  constructor(private readonly windowMs: number) {}

  /** Un message vient de partir pour cette clé : la fenêtre de regroupement démarre. */
  arm(key: string, payload: T, now: Date): void {
    this.entries.set(key, { payload, count: 0, since: now });
  }

  /**
   * Occurrence de plus. Renvoie `false` si la clé n'a jamais été annoncée : il n'y
   * a alors rien à cumuler, et surtout personne à qui rappeler quoi que ce soit.
   */
  add(key: string, update?: (previous: T) => T): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (update) entry.payload = update(entry.payload);
    entry.count += 1;
    return true;
  }

  /**
   * Clés dont la fenêtre est écoulée : celles qui ont compté partent en récapitulatif
   * (et repartent pour une fenêtre), les silencieuses s'éteignent — un problème qui
   * ne refrappe plus ne doit plus rien envoyer.
   */
  due(now: Date): Array<DueDigest<T>> {
    const ready: Array<DueDigest<T>> = [];
    for (const [key, entry] of this.entries) {
      if (now.getTime() - entry.since.getTime() < this.windowMs) continue;
      if (entry.count === 0) {
        this.entries.delete(key);
        continue;
      }
      ready.push({ key, payload: entry.payload, count: entry.count, since: entry.since });
      entry.count = 0;
      entry.since = now;
    }
    return ready;
  }

  /** Nombre de problèmes suivis — pour les logs et les tests. */
  get size(): number {
    return this.entries.size;
  }
}
