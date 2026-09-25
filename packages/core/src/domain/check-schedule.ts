/**
 * Échéance d'un check planifié.
 *
 * Les monitors sont réveillés par un cron à la minute, mais chacun a sa propre cadence :
 * le tick décide, monitor par monitor, si l'échéance est atteinte. Le piège est que la date
 * du dernier check est estampillée *après* l'exécution du check : au tick censé relancer un
 * monitor de 120 s, il ne s'est écoulé que ~119,7 s depuis le précédent. Une comparaison
 * stricte saute donc ce tick et attend le suivant — cadence réelle de 180 s au lieu de 120,
 * assez pour qu'une sonde externe réclame un beat qui n'est pas encore parti.
 */

/**
 * Tolérance sur l'échéance, en millisecondes. Une demi-période de cron : assez pour absorber
 * la durée du check, trop peu pour déclencher deux checks dans la même minute.
 */
export const CHECK_DUE_TOLERANCE_MS = 30_000;

/** Le monitor a-t-il atteint son échéance ? Un monitor jamais checké l'est toujours. */
export function isCheckDue(
  lastCheckAt: Date | null | undefined,
  intervalSeconds: number,
  now: number,
): boolean {
  if (!lastCheckAt) return true;
  const due = Math.max(0, intervalSeconds * 1000 - CHECK_DUE_TOLERANCE_MS);
  return now - lastCheckAt.getTime() >= due;
}
