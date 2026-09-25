/**
 * Une demande enregistrée à laquelle rien n'a jamais répondu.
 *
 * Le cas visé n'est pas l'appel qui échoue — celui-là écrit son constat dans la
 * conversation. C'est l'échec dont personne ne revient : le process tombe, la
 * requête est coupée, l'onglet se ferme. Aucun `catch` ne s'exécute, la demande
 * reste seule en bas du fil, et rien ne le dit — on relance le lendemain par
 * « c'est pas fini ! ».
 */

/**
 * Délai avant de conclure au silence. Un tour enchaîne plusieurs allers-retours
 * d'outils : en dessous, on prendrait un travail en cours pour un échec, et
 * proposer de relancer ferait partir deux tours en parallèle sur la même demande.
 */
export const ANSWER_GRACE_MS = 3 * 60_000;

/** Le minimum qu'il faut connaître d'un message pour trancher. */
export interface ChatTurnMessage {
  id: string;
  role: string;
  createdAt: Date;
}

export interface UnansweredRequest {
  messageId: string;
  createdAt: Date;
}

/**
 * La conversation se termine-t-elle sur une demande sans suite ? `null` tant que
 * le tour peut encore être en cours, et `null` aussi sur une conversation qui
 * finit normalement par une réponse.
 */
export function unansweredRequest(
  messages: ChatTurnMessage[],
  now: Date = new Date(),
): UnansweredRequest | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return null;
  if (now.getTime() - last.createdAt.getTime() < ANSWER_GRACE_MS) return null;
  return { messageId: last.id, createdAt: last.createdAt };
}
