/**
 * Un débit d'appels à ne pas dépasser, pour une plateforme qui en impose un.
 *
 * n8n auto-hébergé ne plafonne rien ; Make plafonne à l'organisation — 30
 * appels/minute sur un plan Free, 1 000 en Enterprise. Sous 30/min, les gestes
 * de masse de la plateforme (resynchro horaire, analyse d'un parc, export)
 * dépassent le budget en quelques secondes s'ils partent 4 de front comme
 * ailleurs. Le plafond ne se contourne pas : il se respecte, et l'appelant
 * attend.
 *
 * Fenêtre glissante plutôt que jeton par jeton : c'est ce que compte le serveur,
 * et un lissage régulier ferait attendre pour rien un parc de dix scénarios.
 *
 * Pur et déterministe : l'horloge est injectée, donc testable sans dormir.
 */
export class RateBudget {
  private readonly hits: number[] = [];

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Combien de millisecondes attendre avant le prochain appel. `0` = tout de
   * suite. Un plafond nul ou négatif signifie « aucune limite ».
   */
  delayMs(): number {
    if (this.perMinute <= 0) return 0;
    this.forget();
    if (this.hits.length < this.perMinute) return 0;
    return Math.max(0, this.hits[0] + 60_000 - this.now());
  }

  /** À appeler juste avant de partir : c'est l'appel qui compte, pas la réponse. */
  record(): void {
    if (this.perMinute <= 0) return;
    this.forget();
    this.hits.push(this.now());
  }

  private forget(): void {
    const floor = this.now() - 60_000;
    while (this.hits.length > 0 && this.hits[0] <= floor) this.hits.shift();
  }
}
