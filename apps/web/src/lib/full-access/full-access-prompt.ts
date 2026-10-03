/**
 * « Accès complet à cette instance » : le compte n8n propriétaire, fortement
 * recommandé mais jamais imposé. La règle est ici, pure, pour que le formulaire,
 * la fiche et la liste disent exactement la même chose.
 */

/** Le module qui porte l'administration d'Ops : sans lui, rien n'est demandé. */
export const ADMIN_MODULE_ID = 'module-admin';

/** Ce que l'API dit d'une instance, sans jamais le mot de passe. */
export interface FullAccessState {
  platform: string;
  hasN8nLogin: boolean;
  fullAccessDismissedAt: string | Date | null;
}

/** Liste inconnue (`null`) = module actif : la même lecture que le reste de la console. */
export function adminModuleEnabled(enabled: string[] | null): boolean {
  return !enabled || enabled.includes(ADMIN_MODULE_ID);
}

/** Relancer ? Seulement pour un n8n sans compte, tant que personne n'a dit « ne plus me demander ». */
export function needsFullAccessPrompt(state: FullAccessState & { adminEnabled: boolean }): boolean {
  if (!state.adminEnabled) return false;
  if (state.platform !== 'n8n') return false;
  if (state.hasN8nLogin) return false;
  return !state.fullAccessDismissedAt;
}

export interface FullAccessFormValues {
  n8nEmail?: string | null;
  n8nPassword?: string | null;
}

/**
 * Le formulaire a-t-il un compte ? En édition, un mot de passe vide signifie
 * « garder celui enregistré » (convention du formulaire), d'où `existing`.
 * Un e-mail vide retire le compte, mot de passe compris.
 */
export function formHasN8nLogin(
  values: FullAccessFormValues,
  existing: { hasN8nLogin: boolean } | undefined,
): boolean {
  const email = values.n8nEmail?.trim();
  if (!email) return false;
  return Boolean(values.n8nPassword?.trim()) || Boolean(existing?.hasN8nLogin);
}

export type FullAccessOutcome =
  | { kind: 'with'; n8nEmail: string; n8nPassword: string }
  | { kind: 'without'; dismiss: boolean }
  | { kind: 'closed' };

/**
 * La charge utile à envoyer selon l'issue de la modale. Quelle que soit l'issue,
 * la saisie du formulaire part entière : la modale n'est jamais une raison de
 * ressaisir.
 */
export function fullAccessPayload<T extends object>(
  pending: T,
  outcome: FullAccessOutcome,
): T & Partial<FullAccessFormValues & { fullAccessDismiss: boolean }> {
  switch (outcome.kind) {
    case 'with':
      return { ...pending, n8nEmail: outcome.n8nEmail, n8nPassword: outcome.n8nPassword };
    case 'without':
      return outcome.dismiss ? { ...pending, fullAccessDismiss: true } : { ...pending };
    case 'closed':
      return { ...pending };
  }
}
