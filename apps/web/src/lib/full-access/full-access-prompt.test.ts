import { describe, expect, it } from 'vitest';
import {
  adminModuleEnabled,
  fullAccessPayload,
  formHasN8nLogin,
  needsFullAccessPrompt,
  type FullAccessOutcome,
} from './full-access-prompt';

const n8n = { platform: 'n8n', fullAccessDismissedAt: null };

describe('needsFullAccessPrompt', () => {
  it('relance quand le module admin est actif, le compte n8n absent et personne n’a refusé', () => {
    expect(needsFullAccessPrompt({ adminEnabled: true, hasN8nLogin: false, ...n8n })).toBe(true);
  });

  it('se tait quand le compte n8n est là', () => {
    expect(needsFullAccessPrompt({ adminEnabled: true, hasN8nLogin: true, ...n8n })).toBe(false);
  });

  it('se tait après « ne plus me demander », même après reconnexion', () => {
    expect(
      needsFullAccessPrompt({
        adminEnabled: true,
        hasN8nLogin: false,
        platform: 'n8n',
        fullAccessDismissedAt: '2026-10-01T10:00:00Z',
      }),
    ).toBe(false);
  });

  it('se tait quand le module admin est inactif : comportement d’avant, inchangé', () => {
    expect(needsFullAccessPrompt({ adminEnabled: false, hasN8nLogin: false, ...n8n })).toBe(false);
  });

  it('se tait pour une instance Make : il n’y a pas de compte n8n à demander', () => {
    expect(
      needsFullAccessPrompt({
        adminEnabled: true,
        hasN8nLogin: false,
        platform: 'make',
        fullAccessDismissedAt: null,
      }),
    ).toBe(false);
  });
});

describe('adminModuleEnabled', () => {
  it('lit l’état du module module-admin ; liste inconnue = actif, comme partout dans la console', () => {
    expect(adminModuleEnabled(null)).toBe(true);
    expect(adminModuleEnabled(['module-admin', 'verifier'])).toBe(true);
    expect(adminModuleEnabled(['verifier'])).toBe(false);
  });
});

describe('formHasN8nLogin', () => {
  it('à la création : e-mail et mot de passe saisis', () => {
    expect(formHasN8nLogin({ n8nEmail: 'o@n8n', n8nPassword: 'pw' }, undefined)).toBe(true);
    expect(formHasN8nLogin({ n8nEmail: 'o@n8n', n8nPassword: '' }, undefined)).toBe(false);
    expect(formHasN8nLogin({ n8nEmail: '', n8nPassword: 'pw' }, undefined)).toBe(false);
    expect(formHasN8nLogin({}, undefined)).toBe(false);
  });

  it('en édition : un mot de passe vide garde celui déjà enregistré', () => {
    expect(formHasN8nLogin({ n8nEmail: 'o@n8n', n8nPassword: '' }, { hasN8nLogin: true })).toBe(true);
    expect(formHasN8nLogin({ n8nEmail: 'o@n8n', n8nPassword: '' }, { hasN8nLogin: false })).toBe(false);
  });

  it('en édition : vider l’e-mail retire le compte, mot de passe compris', () => {
    expect(formHasN8nLogin({ n8nEmail: '', n8nPassword: '' }, { hasN8nLogin: true })).toBe(false);
  });
});

describe('fullAccessPayload — la saisie du formulaire n’est jamais perdue', () => {
  const pending = { name: 'Prod', baseUrl: 'http://n8n', apiKey: 'k', clientId: 'c1' };

  it('« Enregistrer avec l’accès complet » ajoute le compte à la saisie', () => {
    const outcome: FullAccessOutcome = { kind: 'with', n8nEmail: 'o@n8n', n8nPassword: 'pw' };
    expect(fullAccessPayload(pending, outcome)).toEqual({ ...pending, n8nEmail: 'o@n8n', n8nPassword: 'pw' });
  });

  it('« Continuer sans » envoie la saisie telle quelle, et le refus seulement si la case est cochée', () => {
    expect(fullAccessPayload(pending, { kind: 'without', dismiss: false })).toEqual(pending);
    expect(fullAccessPayload(pending, { kind: 'without', dismiss: true })).toEqual({
      ...pending,
      fullAccessDismiss: true,
    });
  });

  it('fermer la modale (Échap, croix) sauvegarde tel quel, sans refus', () => {
    expect(fullAccessPayload(pending, { kind: 'closed' })).toEqual(pending);
  });
});
