import { describe, expect, it } from 'vitest';
import { describeWriteEffect, detectPublishModel, writeIsLive } from '../src/domain/n8n/n8n-publish-model';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

const base = { id: 'w', name: 'W', nodes: [], connections: {} } as N8nWorkflow;

describe('detectPublishModel', () => {
  it('clé absente : n8n d’avant la publication par versions', () => {
    expect(detectPublishModel(base)).toBe('direct');
  });

  it('clé à null : instance à versions, workflow jamais publié', () => {
    expect(detectPublishModel({ ...base, activeVersionId: null })).toBe('versioned-unpublished');
  });

  it('clé renseignée : instance à versions, workflow publié', () => {
    expect(detectPublishModel({ ...base, activeVersionId: 'v1' })).toBe('versioned-published');
  });
});

describe('describeWriteEffect', () => {
  it('ne signale rien sur un n8n classique', () => {
    expect(describeWriteEffect('direct', 'W')).toBeUndefined();
  });

  it('ne signale rien sur un workflow publié : le PUT republie de lui-même', () => {
    expect(describeWriteEffect('versioned-published', 'W')).toBeUndefined();
  });

  it('prévient qu’un workflow jamais publié ne recevra qu’un brouillon', () => {
    const message = describeWriteEffect('versioned-unpublished', 'Planification');
    expect(message).toContain('Planification');
    expect(message).toContain('brouillon');
  });
});

describe('writeIsLive', () => {
  it('l’écriture part en production sauf sur un workflow jamais publié', () => {
    expect(writeIsLive('direct')).toBe(true);
    expect(writeIsLive('versioned-published')).toBe(true);
    expect(writeIsLive('versioned-unpublished')).toBe(false);
  });
});
