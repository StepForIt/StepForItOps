import { describe, expect, it } from 'vitest';
import { detectWorkflowEnv, isMonitoredEnv, withEnvSuffix } from '../src/domain/workflow-env';
import { normalizeEnvs } from '../src/domain/env';

/** Une maison sans preprod, mais avec une recette client. */
const CUSTOM = normalizeEnvs([{ id: 'dev' }, { id: 'recette-client', monitored: true }, { id: 'prod' }]);
const CUSTOM_IDS = CUSTOM.map((env) => env.id);

describe('detectWorkflowEnv', () => {
  it('reads env from tags first', () => {
    expect(detectWorkflowEnv('Workflow 1', ['env:dev'])).toBe('dev');
    expect(detectWorkflowEnv('Workflow 1 - PROD', ['env:dev'])).toBe('dev');
    expect(detectWorkflowEnv('X', ['ENV:PROD'])).toBe('prod');
  });

  it('falls back to name suffix', () => {
    expect(detectWorkflowEnv('Workflow 1 - DEV', [])).toBe('dev');
    expect(detectWorkflowEnv('Sync commandes [prod]', [])).toBe('prod');
    expect(detectWorkflowEnv('Facturation PREPROD', [])).toBe('preprod');
  });

  it('returns null when undetermined', () => {
    expect(detectWorkflowEnv('Workflow développement', [])).toBeNull();
    expect(detectWorkflowEnv('Provisioning', ['crm'])).toBeNull();
  });

  it('ne reconnaît que les envs déclarés', () => {
    expect(detectWorkflowEnv('Facturation - RECETTE-CLIENT', [], CUSTOM_IDS)).toBe('recette-client');
    expect(detectWorkflowEnv('Facturation - RECETTE-CLIENT', [], ['dev', 'prod'])).toBeNull();
    // preprod n'est plus déclarée : le suffixe n'est plus un env, c'est du texte.
    expect(detectWorkflowEnv('Facturation PREPROD', [], CUSTOM_IDS)).toBeNull();
  });
});

describe('withEnvSuffix', () => {
  it('replaces an existing env suffix', () => {
    expect(withEnvSuffix('Workflow 1 - DEV', 'prod')).toBe('Workflow 1 - PROD');
    expect(withEnvSuffix('Sync commandes [prod]', 'dev')).toBe('Sync commandes - DEV');
  });

  it('appends when no suffix', () => {
    expect(withEnvSuffix('Facturation', 'preprod')).toBe('Facturation - PREPROD');
  });
});

describe('isMonitoredEnv', () => {
  it('ne surveille que la prod et les workflows sans env', () => {
    expect(isMonitoredEnv('prod')).toBe(true);
    expect(isMonitoredEnv(null)).toBe(true);
    expect(isMonitoredEnv('dev')).toBe(false);
    expect(isMonitoredEnv('preprod')).toBe(false);
  });

  it('suit la case cochée sur l’env, pas son nom', () => {
    expect(isMonitoredEnv('recette-client', CUSTOM)).toBe(true);
    expect(isMonitoredEnv('dev', CUSTOM)).toBe(false);
    // Env déclaré nulle part : indéterminé côté détection, donc jamais silencieux.
    expect(isMonitoredEnv(null, CUSTOM)).toBe(true);
  });
});

describe('withEnvSuffix, envs déclarés', () => {
  it('remplace le suffixe d’un env déclaré, et lui seul', () => {
    expect(withEnvSuffix('Facturation - RECETTE-CLIENT', 'prod', CUSTOM_IDS)).toBe('Facturation - PROD');
    // « PREPROD » n'est pas un env ici : il fait partie du nom.
    expect(withEnvSuffix('Facturation PREPROD', 'prod', CUSTOM_IDS)).toBe('Facturation PREPROD - PROD');
  });
});
