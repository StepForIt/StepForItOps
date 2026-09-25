import { BadGatewayException, HttpException, UnprocessableEntityException } from '@nestjs/common';
import { N8nApiError, describePublishRefusal, parsePublishRefusal } from '@nwm/core';

/**
 * n8n qui refuse la clé API ou le compte de l'instance. C'est un réglage à
 * reprendre, pas une panne de la plateforme : le filtre global ne le remonte
 * pas à Sentry, où chaque clic sur « Synchroniser » ouvrait un événement de plus.
 */
export class N8nAuthRefusedException extends BadGatewayException {}

export function isN8nAuthRefusal(error: N8nApiError): boolean {
  return error.status === 401 || error.status === 403;
}

export function n8nAuthRefused(error: N8nApiError): N8nAuthRefusedException {
  const what =
    error.status === 401
      ? 'refuse la clé API ou le compte de cette instance (401) : révoqué ou régénéré côté n8n'
      : "n'autorise pas cette opération à la clé API ou au compte de cette instance (403)";
  return new N8nAuthRefusedException(
    `n8n ${what}. À mettre à jour dans la fiche de l'instance. Détail : ${error.message.slice(0, 300)}`,
  );
}

/**
 * Traduit un refus de l'API n8n en exception HTTP parlante. n8n qui refuse
 * d'enregistrer un workflow incomplet de son point de vue n'est pas un plantage de
 * la plateforme : le rendre en 500 « Internal server error » n'apprenait ni ce qui
 * bloque ni sur quels nœuds — alors que ce message-là est justement ce qui permet
 * de décider en connaissance de cause.
 *
 * Volontairement limité à ce refus-là et aux refus d'authentification : les autres
 * erreurs n8n restent au filtre global (500 + journalisation), et les 404 sont
 * déjà traités par leurs appelants.
 */
export function httpExceptionFromN8n(error: unknown): HttpException | undefined {
  if (!(error instanceof N8nApiError)) return undefined;
  if (isN8nAuthRefusal(error)) return n8nAuthRefused(error);
  const refusal = parsePublishRefusal(error.message);
  return refusal ? new UnprocessableEntityException(describePublishRefusal(refusal)) : undefined;
}
