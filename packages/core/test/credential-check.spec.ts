import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_CHECKS,
  DEFAULT_CREDENTIAL_SCHEDULE,
  credentialAlertDecision,
  credentialCheckDue,
  classifyCredentialProbe,
  credentialCheckFor,
  credentialProbeRequest,
  hasQuotaCheck,
  needsAttention,
} from '../src';

describe('classifyCredentialProbe', () => {
  it('un succès est ok, un 401 est refusé', () => {
    expect(classifyCredentialProbe({ status: 200 })).toBe('ok');
    expect(classifyCredentialProbe({ status: 401, detail: 'Incorrect API key' })).toBe('rejected');
  });

  it('distingue le 429 « trop vite » du 429 « plus de crédit » (OpenAI)', () => {
    expect(classifyCredentialProbe({ status: 429, detail: 'Rate limit reached for requests' })).toBe(
      'rate-limited',
    );
    expect(classifyCredentialProbe({ status: 429, detail: 'You exceeded your current quota' })).toBe(
      'no-credit',
    );
    expect(classifyCredentialProbe({ status: 429, detail: 'insufficient_quota' })).toBe('no-credit');
  });

  it('reconnaît le compte à sec d’Anthropic, qui répond 400 et non 429', () => {
    const detail = 'Your credit balance is too low to access the Anthropic API.';
    expect(classifyCredentialProbe({ status: 400, detail })).toBe('no-credit');
  });

  it('402 est toujours un manque de crédit', () => {
    expect(classifyCredentialProbe({ status: 402 })).toBe('no-credit');
  });

  it('sans réponse ou en 5xx, la credential n’est pas en cause', () => {
    expect(classifyCredentialProbe({})).toBe('unreachable');
    expect(classifyCredentialProbe({ status: 503 })).toBe('unreachable');
  });

  it('une réponse illisible n’est jamais présentée comme verte', () => {
    expect(classifyCredentialProbe({ status: 404, detail: 'model_not_found' })).toBe('unknown');
  });

  it('seuls refus et crédit épuisé demandent une action', () => {
    expect(needsAttention('rejected')).toBe(true);
    expect(needsAttention('no-credit')).toBe(true);
    expect(needsAttention('rate-limited')).toBe(false);
    expect(needsAttention('unknown')).toBe(false);
  });
});

describe('catalogue des fournisseurs', () => {
  it('retrouve le fournisseur par type de credential n8n', () => {
    expect(credentialCheckFor('openAiApi')?.provider).toBe('openai');
    expect(credentialCheckFor('slackApi')).toBeNull();
  });

  it('Perplexity n’a rien de gratuit : les deux niveaux font le même appel', () => {
    const perplexity = credentialCheckFor('perplexityApi')!;
    expect(hasQuotaCheck(perplexity)).toBe(false);
    expect(credentialProbeRequest(perplexity, 'auth')).toBe(credentialProbeRequest(perplexity, 'quota'));
  });

  it('le niveau accès est gratuit (GET), le niveau crédit génère (POST)', () => {
    for (const spec of CREDENTIAL_CHECKS.filter(hasQuotaCheck)) {
      expect(credentialProbeRequest(spec, 'auth').method ?? 'GET').toBe('GET');
      expect(credentialProbeRequest(spec, 'quota').method).toBe('POST');
    }
  });
});

describe('credentialCheckDue', () => {
  const NOW = new Date('2026-10-08T08:00:00Z');
  const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
  const openai = credentialCheckFor('openAiApi')!;
  const perplexity = credentialCheckFor('perplexityApi')!;

  it('une credential jamais testée est due tout de suite', () => {
    expect(credentialCheckDue(openai, {}, DEFAULT_CREDENTIAL_SCHEDULE, NOW)).toBe('quota');
  });

  it('accès chaque jour, crédit chaque semaine (OpenAI)', () => {
    const recentCredit = { lastCreditAt: ago(24), lastAccessAt: ago(25) };
    expect(credentialCheckDue(openai, recentCredit, DEFAULT_CREDENTIAL_SCHEDULE, NOW)).toBe('auth');
    expect(
      credentialCheckDue(
        openai,
        { lastCreditAt: ago(24), lastAccessAt: ago(2) },
        DEFAULT_CREDENTIAL_SCHEDULE,
        NOW,
      ),
    ).toBeNull();
    expect(
      credentialCheckDue(
        openai,
        { lastCreditAt: ago(170), lastAccessAt: ago(2) },
        DEFAULT_CREDENTIAL_SCHEDULE,
        NOW,
      ),
    ).toBe('quota');
  });

  it('chez Perplexity un seul appel payant, une fois par semaine', () => {
    expect(
      credentialCheckDue(perplexity, { lastAccessAt: ago(100) }, DEFAULT_CREDENTIAL_SCHEDULE, NOW),
    ).toBeNull();
    expect(credentialCheckDue(perplexity, { lastAccessAt: ago(170) }, DEFAULT_CREDENTIAL_SCHEDULE, NOW)).toBe(
      'quota',
    );
  });

  it('suit les fréquences réglées dans les paramètres', () => {
    const hourly = { accessEveryHours: 1, paidAccessEveryHours: 168, creditEveryHours: 720 };
    expect(credentialCheckDue(openai, { lastCreditAt: ago(5), lastAccessAt: ago(2) }, hourly, NOW)).toBe(
      'auth',
    );
  });
});

describe('credentialAlertDecision', () => {
  it('alerte à l’entrée en panne, pas à chaque passage', () => {
    expect(credentialAlertDecision(null, 'rejected', 'auth')).toBe('alert');
    expect(credentialAlertDecision('rejected', 'rejected', 'auth')).toBe('none');
  });

  it('alerte de nouveau quand la nature de la panne change', () => {
    expect(credentialAlertDecision('rejected', 'no-credit', 'quota')).toBe('alert');
  });

  it('ne lève pas une alerte de crédit sur un simple accès accepté', () => {
    expect(credentialAlertDecision('no-credit', 'ok', 'auth')).toBe('none');
    expect(credentialAlertDecision('no-credit', 'ok', 'quota')).toBe('clear');
    expect(credentialAlertDecision('rejected', 'ok', 'auth')).toBe('clear');
  });

  it('une limite de débit ou une panne réseau n’alerte ni ne lève rien', () => {
    expect(credentialAlertDecision(null, 'rate-limited', 'auth')).toBe('none');
    expect(credentialAlertDecision('rejected', 'unreachable', 'auth')).toBe('none');
  });
});
