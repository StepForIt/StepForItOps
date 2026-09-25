import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_AUDIT_THRESHOLDS,
  LlmNodeRequirement,
  ModelCatalogEntry,
  ModelTier,
  bestCandidate,
  isFloatingAlias,
  modelSavings,
  runModelAudit,
} from '../src';

const catalog: ModelCatalogEntry[] = [
  {
    pattern: 'claude-sonnet-5',
    provider: 'anthropic',
    inputPerMTok: 3,
    outputPerMTok: 15,
    status: 'active',
    tier: 'standard',
    supportsVision: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 200_000,
  },
  {
    pattern: 'claude-haiku-4',
    provider: 'anthropic',
    inputPerMTok: 1,
    outputPerMTok: 5,
    status: 'active',
    tier: 'light',
    supportsVision: true,
    supportsTools: true,
    supportsStructuredOutput: true,
    contextWindow: 200_000,
  },
  {
    pattern: 'gpt-3.5-turbo',
    provider: 'openai',
    inputPerMTok: 0.5,
    outputPerMTok: 1.5,
    status: 'retired',
    tier: 'light',
    supportsVision: false,
    supportsTools: true,
    supportsStructuredOutput: false,
    contextWindow: 16_385,
    replacedByPattern: 'gpt-4o-mini',
  },
  {
    pattern: 'mystere-1',
    provider: 'other',
    inputPerMTok: 4,
    outputPerMTok: 20,
    status: 'active',
    tier: 'standard',
    supportsVision: null,
    supportsTools: null,
    supportsStructuredOutput: null,
    contextWindow: null,
  },
];

function node(overrides: Partial<LlmNodeRequirement> = {}): LlmNodeRequirement {
  return {
    nodeName: 'Chat Model',
    model: 'claude-sonnet-5',
    needsVision: false,
    needsTools: false,
    needsStructuredOutput: false,
    servesNode: 'Traduire',
    ...overrides,
  };
}

const usage = {
  calls: 500,
  promptTokens: 5_000_000,
  completionTokens: 500_000,
  promptTokensP95: 12_000,
  days: 30,
};
const codes = (findings: { code: string }[]) => findings.map((finding) => finding.code);

describe('runModelAudit — aptitudes', () => {
  it('refuse une image envoyée à un modèle qui ne sait pas la lire', () => {
    const findings = runModelAudit({
      requirements: [node({ model: 'gpt-3.5-turbo', needsVision: true })],
      catalog,
    });
    const vision = findings.find((finding) => finding.code === 'model-missing-vision');
    expect(vision?.severity).toBe('error');
  });

  it("SE TAIT quand l'aptitude est inconnue : un trou de la description n'est pas une faute", () => {
    const findings = runModelAudit({
      requirements: [node({ model: 'mystere-1', needsVision: true, needsTools: true })],
      catalog,
    });
    expect(codes(findings)).not.toContain('model-missing-vision');
    expect(codes(findings)).not.toContain('model-missing-tools');
  });

  it('ne signale une fenêtre trop courte que sur une MESURE', () => {
    const requirement = node({ model: 'gpt-3.5-turbo' });
    const sansMesure = runModelAudit({ requirements: [requirement], catalog });
    expect(codes(sansMesure)).not.toContain('model-context-too-small');

    const avecMesure = runModelAudit({
      requirements: [requirement],
      catalog,
      usageByNode: { 'Chat Model': { ...usage, promptTokensP95: 15_000 } },
    });
    expect(codes(avecMesure)).toContain('model-context-too-small');
  });
});

describe('runModelAudit — cycle de vie', () => {
  it('bloque sur un modèle retiré et nomme son successeur', () => {
    const findings = runModelAudit({ requirements: [node({ model: 'gpt-3.5-turbo' })], catalog });
    const retired = findings.find((finding) => finding.code === 'model-retired');
    expect(retired?.severity).toBe('error');
    expect(retired?.message).toContain('gpt-4o-mini');
  });

  it('dit un modèle absent du catalogue au lieu de le compter conforme', () => {
    const findings = runModelAudit({ requirements: [node({ model: 'llama-42' })], catalog });
    expect(codes(findings)).toEqual(['model-unknown']);
  });

  it('signale un alias flottant', () => {
    expect(isFloatingAlias('claude-sonnet-5-latest')).toBe(true);
    expect(isFloatingAlias('claude-sonnet-5')).toBe(false);
    const findings = runModelAudit({ requirements: [node({ model: 'claude-sonnet-5-latest' })], catalog });
    expect(codes(findings)).toContain('model-floating-alias');
  });

  it('se TAIT sur tout ce qui dépend de la fraîcheur quand le catalogue est périmé', () => {
    const findings = runModelAudit({
      requirements: [node({ model: 'gpt-3.5-turbo', needsVision: true })],
      catalog,
      catalogStale: true,
    });
    expect(codes(findings)).toContain('model-missing-vision'); // une aptitude ne périme pas
    expect(codes(findings)).not.toContain('model-retired');
  });
});

describe('runModelAudit — économie', () => {
  const taskProfiles: Record<string, ModelTier> = { translation: 'light', reasoning: 'reasoning' };

  it("n'annonce aucune économie sans usage mesuré : le reste est du bruit", () => {
    const findings = runModelAudit({
      requirements: [node()],
      catalog,
      taskByNode: { 'Chat Model': { task: 'translation', confidence: 0.9, source: 'ai' } },
      taskProfiles,
    });
    expect(codes(findings)).not.toContain('model-task-oversized');
  });

  it('autorise la DESCENTE de gamme quand la tâche le permet, et pas autrement', () => {
    const input = {
      requirements: [node()],
      catalog,
      usageByNode: { 'Chat Model': usage },
      taskProfiles,
    };
    // Sans tâche connue : la règle sûre ne descend jamais de tier, donc rien.
    expect(codes(runModelAudit(input))).not.toContain('model-cheaper-alternative');

    const traduction = runModelAudit({
      ...input,
      taskByNode: { 'Chat Model': { task: 'translation', confidence: 0.9, source: 'ai' } },
    });
    const finding = traduction.find((item) => item.code === 'model-task-oversized');
    expect(finding?.severity).toBe('info');
    expect(finding?.data?.candidate).toBe('claude-haiku-4');
    expect(finding?.data?.savingsAnnualUsd).toBeGreaterThan(0);
  });

  it('ignore une classification IA peu sûre, jamais une correction humaine', () => {
    const base = { requirements: [node()], catalog, usageByNode: { 'Chat Model': usage }, taskProfiles };
    const doute = runModelAudit({
      ...base,
      taskByNode: { 'Chat Model': { task: 'translation', confidence: 0.2, source: 'ai' } },
    });
    expect(codes(doute)).not.toContain('model-task-oversized');

    const humain = runModelAudit({
      ...base,
      taskByNode: { 'Chat Model': { task: 'translation', confidence: 0, source: 'manual' } },
    });
    expect(codes(humain)).toContain('model-task-oversized');
  });

  it('se tait sous le seuil d’économie', () => {
    const findings = runModelAudit({
      requirements: [node()],
      catalog,
      usageByNode: { 'Chat Model': usage },
      taskByNode: { 'Chat Model': { task: 'translation', confidence: 1, source: 'manual' } },
      taskProfiles,
      thresholds: { ...DEFAULT_MODEL_AUDIT_THRESHOLDS, savingsThresholdPct: 95 },
    });
    expect(codes(findings)).not.toContain('model-task-oversized');
  });
});

describe('modelSavings', () => {
  it('mesure sur le mix réel quand il existe', () => {
    const savings = modelSavings(catalog[0]!, catalog[1]!, {
      promptTokens: 1_000_000,
      completionTokens: 0,
      days: 30,
    });
    expect(savings?.measured).toBe(true);
    expect(savings?.pct).toBeCloseTo(66.67, 1);
    expect(savings?.annualUsd).toBeGreaterThan(0);
  });

  it("n'annonce rien quand une seule des deux lignes de tarif baisse : le mix déciderait", () => {
    const cher = { pattern: 'x', inputPerMTok: 1, outputPerMTok: 20 };
    const autre = { pattern: 'y', inputPerMTok: 0.5, outputPerMTok: 25 };
    expect(modelSavings(cher, autre)).toBeNull();
  });
});

describe('bestCandidate', () => {
  it('ne recommande JAMAIS un modèle dont on ignore les aptitudes', () => {
    const needs = {
      vision: true,
      tools: false,
      structuredOutput: false,
      minContext: null,
      minTier: 'standard' as ModelTier,
    };
    const candidate = bestCandidate(
      { ...catalog[3]!, inputPerMTok: 50, outputPerMTok: 100 },
      catalog,
      needs,
      {
        sameProvider: false,
      },
    );
    expect(candidate?.entry.pattern).not.toBe('mystere-1');
  });
});
