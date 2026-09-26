import { defineMessages } from '../catalog';

/** Erreurs HTTP transverses : filtres, mappers, garde d'accès. */
export const common = defineMessages(
  {
    internalError: 'Internal server error',
    invalidQuery: 'Invalid request: unknown sort or filter field (check _sort / _order).',
    notFound: 'Resource not found',
    duplicate: 'Duplicate{hasTarget, select, true { on {target}} other {}}: this value already exists',
    missingReference: 'Missing reference (foreign key constraint)',
    n8nAuthRefused401:
      'n8n rejects the API key or account of this instance (401): revoked or regenerated in n8n. Update it on the instance page. Detail: {detail}',
    n8nAuthRefused403:
      'n8n does not allow this operation for the API key or account of this instance (403). Update it on the instance page. Detail: {detail}',
    apiTokenInvalid: 'Missing or invalid API access token',
  },
  {
    internalError: 'Erreur interne du serveur',
    invalidQuery: 'Requête invalide : champ de tri ou de filtre inconnu (vérifier _sort / _order).',
    notFound: 'Ressource introuvable',
    duplicate: 'Doublon{hasTarget, select, true { sur {target}} other {}} : cette valeur existe déjà',
    missingReference: 'Référence inexistante (contrainte de clé étrangère)',
    n8nAuthRefused401:
      "n8n refuse la clé API ou le compte de cette instance (401) : révoqué ou régénéré côté n8n. À mettre à jour dans la fiche de l'instance. Détail : {detail}",
    n8nAuthRefused403:
      "n8n n'autorise pas cette opération à la clé API ou au compte de cette instance (403). À mettre à jour dans la fiche de l'instance. Détail : {detail}",
    apiTokenInvalid: "Jeton d'accès API manquant ou invalide",
  },
);
