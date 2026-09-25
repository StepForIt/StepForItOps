import { describe, expect, it } from 'vitest';
import {
  declaredEntryPath,
  entryUrlPath,
  hasEntryUrl,
  withDeclaredEntryPath,
} from '../src/domain/n8n/entry-path';
import { N8nNode } from '../src/domain/n8n/workflow.types';

const form = (typeVersion: number, parameters: Record<string, unknown>, webhookId = 'f0rm1d'): N8nNode => ({
  id: '1',
  name: 'On form submission',
  type: 'n8n-nodes-base.formTrigger',
  typeVersion,
  position: [0, 0],
  parameters,
  webhookId,
});

const webhook = (path: unknown): N8nNode => ({
  id: '2',
  name: 'Webhook',
  type: 'n8n-nodes-base.webhook',
  position: [0, 0],
  parameters: { path },
  webhookId: 'w3bh00k',
});

describe('hasEntryUrl', () => {
  it('reconnaît le Webhook et tout nœud porteur d’un webhookId', () => {
    expect(hasEntryUrl(webhook('x'))).toBe(true);
    expect(hasEntryUrl(form(2.2, {}))).toBe(true);
    expect(
      hasEntryUrl({ id: '3', name: 'Set', type: 'n8n-nodes-base.set', position: [0, 0], parameters: {} }),
    ).toBe(false);
  });
});

describe('declaredEntryPath', () => {
  it('lit le path au premier niveau jusqu’au Form Trigger 2.1', () => {
    expect(declaredEntryPath(form(2.1, { path: 'contact' }))).toBe('contact');
    expect(declaredEntryPath(form(1, { path: 'contact' }))).toBe('contact');
  });

  it('lit le path dans les options à partir du Form Trigger 2.2', () => {
    expect(declaredEntryPath(form(2.2, { options: { path: 'contact' } }))).toBe('contact');
    // Un path resté au premier niveau y est masqué par n8n : il ne sert plus.
    expect(declaredEntryPath(form(2.5, { path: 'ancien' }))).toBeUndefined();
  });

  it('ne voit rien quand le formulaire n’a pas de path à lui', () => {
    expect(declaredEntryPath(form(2.2, {}))).toBeUndefined();
    expect(declaredEntryPath(form(2.2, { options: { path: '  ' } }))).toBeUndefined();
  });
});

describe('entryUrlPath', () => {
  it('retombe sur le webhookId quand aucun path n’est déclaré, comme n8n', () => {
    expect(entryUrlPath(form(2.2, {}))).toBe('f0rm1d');
    expect(entryUrlPath(form(2.2, { options: { path: '/contact/' } }))).toBe('contact');
  });

  it('ne donne pas d’URL à un Webhook sans path', () => {
    expect(entryUrlPath(webhook(''))).toBeUndefined();
    expect(entryUrlPath(webhook('commande'))).toBe('commande');
  });
});

describe('withDeclaredEntryPath', () => {
  it('écrit là où la version du nœud le lit', () => {
    expect(withDeclaredEntryPath(form(2.1, { path: 'a' }), 'b').parameters).toEqual({ path: 'b' });
    expect(
      withDeclaredEntryPath(form(2.2, { formTitle: 'T', options: { buttonLabel: 'OK' } }), 'b').parameters,
    ).toEqual({ formTitle: 'T', options: { buttonLabel: 'OK', path: 'b' } });
  });

  it('retire le path déclaré pour rendre l’URL au webhookId', () => {
    expect(
      withDeclaredEntryPath(form(2.2, { options: { path: 'a', buttonLabel: 'OK' } }), undefined).parameters,
    ).toEqual({ options: { buttonLabel: 'OK' } });
    expect(withDeclaredEntryPath(form(2.1, { path: 'a', formTitle: 'T' }), undefined).parameters).toEqual({
      formTitle: 'T',
    });
  });
});
