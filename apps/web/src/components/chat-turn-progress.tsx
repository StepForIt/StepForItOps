'use client';

import React from 'react';
import { Space, Spin, Typography } from 'antd';
import { CheckCircleTwoTone, CloseCircleTwoTone } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiGet } from '../lib/api';
import { BRAND } from '../lib/brand/colors';

interface TurnProgressStep {
  label: string;
  detail?: string;
  done: boolean;
  failed?: boolean;
}

interface TurnProgress {
  startedAt: string;
  steps: TurnProgressStep[];
  running: boolean;
}

/** Cadence du sondage : assez court pour que la ligne suive l'assistant, assez long pour ne pas marteler l'API. */
const POLL_MS = 1200;

/** Étapes terminées affichées d'emblée. Au-delà, la liste se lit moins qu'elle n'occupe. */
const VISIBLE_STEPS = 5;

interface FoldedStep extends TurnProgressStep {
  /** Combien de fois cette même étape a été jouée dans le tour. */
  count: number;
}

/**
 * Un tour joue la même étape des dizaines de fois — « Poursuite de l'analyse » entre chaque
 * outil, « Vérification du brouillon » à chaque passe — et la liste brute en devient
 * illisible. On garde une ligne par étape distincte, avec son compteur.
 */
function foldSteps(steps: TurnProgressStep[]): FoldedStep[] {
  const folded: FoldedStep[] = [];
  const byKey = new Map<string, FoldedStep>();
  for (const step of steps) {
    const key = `${step.label}\u0000${step.detail ?? ''}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.count += 1;
      // Un échec ne doit pas disparaître dans le repli d'une étape par ailleurs réussie.
      if (step.failed) seen.failed = true;
      continue;
    }
    const entry = { ...step, count: 1 };
    byKey.set(key, entry);
    folded.push(entry);
  }
  return folded;
}

/**
 * Ce que l'assistant fait pendant qu'on l'attend.
 *
 * Un tour dure des dizaines de secondes — relecture du workflow dans n8n,
 * contexte, plusieurs allers-retours d'outils — et l'appel qui le porte est
 * bloquant : il ne peut rien dire avant d'avoir fini. D'où le sondage, seul
 * moyen de montrer l'avancement sans réécrire l'envoi en flux.
 *
 * Le compteur de secondes compte autant que les étapes : c'est lui qui distingue
 * une attente normale d'un écran figé.
 */
export function ChatTurnProgress({ sessionId }: { sessionId: string }) {
  const t = useTranslations('chat.turnProgress');
  const [progress, setProgress] = React.useState<TurnProgress | null>(null);
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    setProgress(null);
    setElapsed(0);
    let stopped = false;
    const poll = async () => {
      try {
        const next = await apiGet<TurnProgress | null>(`/workflow-chat/sessions/${sessionId}/progress`);
        if (!stopped) setProgress(next);
      } catch {
        // Un sondage raté ne dit rien du tour : on garde la dernière image.
      }
    };
    void poll();
    const polling = setInterval(poll, POLL_MS);
    const ticking = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => {
      stopped = true;
      clearInterval(polling);
      clearInterval(ticking);
    };
  }, [sessionId]);

  const [expanded, setExpanded] = React.useState(false);
  const steps = React.useMemo(() => progress?.steps ?? [], [progress]);
  const current = steps.length > 0 ? steps[steps.length - 1] : null;
  // La dernière étape est déjà sur la ligne du haut : le repli ne porte que ce qui précède.
  const done = React.useMemo(() => foldSteps(steps.slice(0, -1)), [steps]);
  const hidden = expanded ? 0 : Math.max(0, done.length - VISIBLE_STEPS);
  const shown = done.slice(hidden);

  return (
    <div style={{ padding: 8 }}>
      <Space>
        <Spin size="small" />
        <Typography.Text type="secondary">
          {current && !current.done ? current.label : t('analysing')}
          {current && !current.done && current.detail ? ` — ${current.detail}` : ''}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {elapsed}s
        </Typography.Text>
      </Space>
      {done.length > 0 && (
        <div style={{ marginTop: 4, paddingInlineStart: 22 }}>
          {hidden > 0 && (
            <Typography.Link style={{ fontSize: 12 }} onClick={() => setExpanded(true)}>
              {t('showPrevious', { count: hidden })}
            </Typography.Link>
          )}
          {shown.map((step, index) => (
            <div key={`${step.label}-${index}`}>
              <Space size={6}>
                {step.failed ? (
                  <CloseCircleTwoTone twoToneColor={BRAND.danger} style={{ fontSize: 11 }} />
                ) : (
                  <CheckCircleTwoTone twoToneColor={BRAND.success} style={{ fontSize: 11 }} />
                )}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {step.label}
                  {step.detail ? ` — ${step.detail}` : ''}
                  {step.count > 1 ? ` ×${step.count}` : ''}
                </Typography.Text>
              </Space>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
