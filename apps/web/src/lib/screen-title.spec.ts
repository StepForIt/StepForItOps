import { describe, expect, it } from 'vitest';
import { formatDocumentTitle, matchRoute, resolveScreenLabel, type ScreenRoute } from './screen-title';

const ROUTES: ScreenRoute[] = [
  { pattern: '/', label: 'Accueil' },
  { pattern: '/workflows', label: 'Workflows' },
  { pattern: '/workflows/show/:id', label: 'Workflow' },
  { pattern: '/errors', label: 'Erreurs' },
  { pattern: '/instances', label: 'Instances' },
  { pattern: '/instances/create', label: 'Nouvelle instance n8n' },
  { pattern: '/instances/show/:id', label: 'Instance' },
  { pattern: '/instances/edit/:id', label: 'Modifier — Instances' },
];

describe('matchRoute', () => {
  it('matche un chemin exact', () => {
    expect(matchRoute('/errors', '/errors')).toBe(true);
    expect(matchRoute('/errors', '/workflows')).toBe(false);
  });

  it('matche un segment dynamique', () => {
    expect(matchRoute('/workflows/show/abc123', '/workflows/show/:id')).toBe(true);
    expect(matchRoute('/workflows/show/abc123/extra', '/workflows/show/:id')).toBe(false);
  });

  it('ignore une barre oblique finale', () => {
    expect(matchRoute('/errors/', '/errors')).toBe(true);
    expect(matchRoute('/', '/')).toBe(true);
  });

  it('exige le même nombre de segments', () => {
    expect(matchRoute('/instances/show', '/instances/show/:id')).toBe(false);
  });
});

describe('resolveScreenLabel', () => {
  it('résout un chemin de liste', () => {
    expect(resolveScreenLabel('/errors', ROUTES)).toBe('Erreurs');
    expect(resolveScreenLabel('/', ROUTES)).toBe('Accueil');
  });

  it('résout une page de détail par son segment dynamique', () => {
    expect(resolveScreenLabel('/workflows/show/wf_42', ROUTES)).toBe('Workflow');
    expect(resolveScreenLabel('/instances/edit/i_7', ROUTES)).toBe('Modifier — Instances');
  });

  it('préfère le chemin statique le plus spécifique au dynamique', () => {
    // /instances/create est statique et doit primer sur /instances/show/:id
    expect(resolveScreenLabel('/instances/create', ROUTES)).toBe('Nouvelle instance n8n');
  });

  it('rend null pour un chemin inconnu', () => {
    expect(resolveScreenLabel('/nowhere', ROUTES)).toBeNull();
    expect(resolveScreenLabel('/errors/deep/unknown', ROUTES)).toBeNull();
  });
});

describe('formatDocumentTitle', () => {
  it('suffixe le nom de la console', () => {
    expect(formatDocumentTitle('Erreurs')).toBe('Erreurs · StepForIt Ops');
  });

  it('retombe sur le nom de la console seul', () => {
    expect(formatDocumentTitle(null)).toBe('StepForIt Ops');
    expect(formatDocumentTitle('')).toBe('StepForIt Ops');
  });
});
