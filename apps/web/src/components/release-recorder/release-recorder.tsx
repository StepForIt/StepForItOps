'use client';

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { App, Drawer, FloatButton, Grid } from 'antd';
import { OrderedListOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, onApiWrite } from '../../lib/api';
import { useEnabledModules } from '../../lib/enabled-modules';
import { RecorderPanel } from './recorder-panel';
import { frozenCount, nextToPlay } from './procedure-edit';
import { EnvShift, playAutoStep, replayEnv, replayTargetEnv } from './replay';
import type { EnvHop, GestureDraft, Procedure, ProcedureStep, StepRun } from './types';

type Mode = 'idle' | 'recording' | 'viewing' | 'playing';

export interface ReleaseRecorderValue {
  mode: Mode;
  procedure: Procedure | null;
  hop: EnvHop | null;
  runs: Record<string, StepRun>;
  busy: boolean;
  /** Étapes figées en tête par le rejeu : ni déplacées, ni supprimées, rien ne s'insère avant. */
  frozen: number;
  startRecording: (name: string) => Promise<void>;
  stopRecording: () => Promise<void>;
  open: (procedureId: string, hop?: EnvHop) => Promise<void>;
  close: () => void;
  /** Sans position : à la fin, ou devant la première étape qui reste à jouer. */
  addManual: (label: string, position?: number) => Promise<void>;
  addGesture: (gesture: GestureDraft, position?: number) => Promise<void>;
  updateStep: (stepId: string, patch: { label?: string; note?: string | null }) => Promise<void>;
  /** Refait le geste d'une étape automatique encore à jouer. */
  updateGesture: (stepId: string, gesture: GestureDraft) => Promise<void>;
  /** L'ordre complet des étapes. */
  reorder: (order: string[]) => Promise<void>;
  removeStep: (stepId: string) => Promise<void>;
  play: () => void;
  validate: (stepId: string) => void;
  retry: (stepId: string) => void;
  skip: (stepId: string) => void;
  /** Rejoue un geste que le rejeu a trouvé déjà en place. */
  redo: (stepId: string) => void;
  shift: EnvShift;
}

const RecorderContext = React.createContext<ReleaseRecorderValue | null>(null);

export function useReleaseRecorder(): ReleaseRecorderValue {
  const value = useContext(RecorderContext);
  if (!value) throw new Error('useReleaseRecorder hors de ReleaseRecorderProvider');
  return value;
}

const PANEL_WIDTH = 340;
const TODO: StepRun = { state: 'todo' };

/**
 * L'enregistreur de procédures, monté une fois dans la console : pendant un
 * enregistrement, chaque écriture réussie part au module `release-procedures`,
 * qui ne garde que les gestes rejouables. Le rejeu tient son état en mémoire :
 * recharger la page le perd, la procédure elle-même reste en base.
 */
export function ReleaseRecorderProvider({ children }: { children: React.ReactNode }) {
  const { enabled } = useEnabledModules();
  const available = !enabled || enabled.includes('release-procedures');
  const { message } = App.useApp();
  const t = useTranslations('reviewTools.recorder');
  const tReplay = useTranslations('reviewTools.recorder.replay');
  const tReplayRef = useRef(tReplay);
  tReplayRef.current = tReplay;
  const tRequests = useTranslations('workflowsList.bulkEnv.requests');
  const tRequestsRef = useRef(tRequests);
  tRequestsRef.current = tRequests;
  const [mode, setMode] = useState<Mode>('idle');
  const [procedure, setProcedure] = useState<Procedure | null>(null);
  const [hop, setHop] = useState<EnvHop | null>(null);
  const [runs, setRuns] = useState<Record<string, StepRun>>({});
  const [busy, setBusy] = useState(false);
  const runsRef = useRef(runs);
  const procedureRef = useRef(procedure);
  procedureRef.current = procedure;

  // La ref d'abord : le rejeu la relit entre deux étapes, sans attendre le rendu suivant.
  const commit = useCallback((next: Procedure | null) => {
    procedureRef.current = next;
    setProcedure(next);
  }, []);

  const setRun = useCallback((stepId: string, run: StepRun) => {
    runsRef.current = { ...runsRef.current, [stepId]: run };
    setRuns(runsRef.current);
  }, []);

  const load = useCallback(
    async (id: string) => {
      const fresh = await apiGet<Procedure>(`/release-procedures/${id}`);
      commit(fresh);
      return fresh;
    },
    [commit],
  );

  // Un enregistrement survit au rechargement : il vit en base.
  useEffect(() => {
    if (!available) return;
    apiGet<{ procedure: Procedure | null }>('/release-procedures/recording')
      .then(({ procedure: active }) => {
        if (!active) return;
        setProcedure(active);
        setMode('recording');
      })
      .catch(() => undefined);
  }, [available]);

  useEffect(() => {
    if (mode !== 'recording') return undefined;
    return onApiWrite(({ method, path, body }) => {
      if (path.startsWith('/release-procedures')) return;
      apiPost<{ captured: boolean }>('/release-procedures/recording/capture', { method, path, body })
        .then(({ captured }) => {
          const current = procedureRef.current;
          if (captured && current) return load(current.id);
          return undefined;
        })
        .catch(() => undefined);
    });
  }, [mode, load]);

  const shift = useCallback<EnvShift>(
    (env, target) => {
      if (!hop || !procedure?.sourceEnv || !procedure.targetEnv) return env;
      const recorded = { source: procedure.sourceEnv, target: procedure.targetEnv };
      return target ? replayTargetEnv(target.action, env, recorded, hop) : replayEnv(env, recorded, hop);
    },
    [hop, procedure],
  );
  const shiftRef = useRef(shift);
  shiftRef.current = shift;

  // L'étape suivante est relue à chaque tour sur la liste COURANTE : réordonner ou supprimer
  // en plein rejeu ne fait ni sauter ni rejouer une étape (le curseur suit les ids).
  const play = useCallback(async () => {
    setBusy(true);
    try {
      for (;;) {
        const step = nextToPlay(procedureRef.current?.steps ?? [], runsRef.current);
        if (!step) break;
        const run = runsRef.current[step.id] ?? TODO;
        if (run.state !== 'todo') break;
        if (step.kind === 'manual') {
          setRun(step.id, { state: 'waiting' });
          break;
        }
        setRun(step.id, { state: 'running' });
        const result = await playAutoStep(
          step,
          shiftRef.current,
          tReplayRef.current,
          tRequestsRef.current,
        ).catch((error: Error): StepRun => ({
          state: 'failed',
          error: error.message,
        }));
        setRun(step.id, result);
        if (result.state !== 'done') break;
      }
    } finally {
      setBusy(false);
    }
  }, [setRun]);

  const validate = useCallback(
    (stepId: string) => {
      const run = runsRef.current[stepId];
      if (run?.state !== 'waiting') return;
      if (!run.resume) {
        setRun(stepId, { state: 'done' });
        void play();
        return;
      }
      setRun(stepId, { state: 'running' });
      run
        .resume()
        .then((summary) => setRun(stepId, { state: 'done', summary }))
        .then(() => play())
        .catch((error: Error) => setRun(stepId, { state: 'failed', error: error.message }));
    },
    [play, setRun],
  );

  const frozen = mode === 'playing' && procedure ? frozenCount(procedure.steps, runs) : 0;
  // Au rejeu, une étape ajoutée se glisse devant la première qui reste à jouer.
  const defaultPosition = mode === 'playing' ? frozen : undefined;

  const value = useMemo<ReleaseRecorderValue>(
    () => ({
      mode,
      procedure,
      hop,
      runs,
      busy,
      frozen,
      shift,
      startRecording: async (name) => {
        const created = await apiPost<Procedure>('/release-procedures/recording', { name });
        setProcedure(created);
        setHop(null);
        setMode('recording');
      },
      stopRecording: async () => {
        if (!procedure) return;
        const stopped = await apiPost<Procedure>(`/release-procedures/${procedure.id}/stop`);
        setProcedure(stopped);
        setMode('viewing');
        message.success(t('saved', { count: stopped.steps.length }));
      },
      open: async (procedureId, nextHop) => {
        if (mode === 'recording' || busy) return;
        await load(procedureId);
        runsRef.current = {};
        setRuns({});
        setHop(nextHop ?? null);
        setMode(nextHop ? 'playing' : 'viewing');
      },
      close: () => {
        if (mode === 'recording' || busy) return;
        setMode('idle');
        setProcedure(null);
        setHop(null);
      },
      addManual: async (label, position) => {
        if (!procedure) return;
        await apiPost(`/release-procedures/${procedure.id}/steps`, {
          label,
          position: position ?? defaultPosition,
          frozen,
        });
        await load(procedure.id);
      },
      addGesture: async (gesture, position) => {
        if (!procedure) return;
        await apiPost(`/release-procedures/${procedure.id}/steps/gesture`, {
          ...gesture,
          position: position ?? defaultPosition,
          frozen,
        });
        await load(procedure.id);
      },
      updateStep: async (stepId, patch) => {
        if (!procedure) return;
        const updated = await apiPatch<ProcedureStep>(
          `/release-procedures/${procedure.id}/steps/${stepId}`,
          patch,
        );
        const current = procedureRef.current;
        if (current?.id === procedure.id) {
          commit({ ...current, steps: current.steps.map((step) => (step.id === stepId ? updated : step)) });
        }
      },
      updateGesture: async (stepId, gesture) => {
        if (!procedure) return;
        await apiPut(`/release-procedures/${procedure.id}/steps/${stepId}/gesture`, { ...gesture, frozen });
        // Ce qu'un rejeu avait tranché (attente, échec) portait sur l'ancien geste.
        if (runsRef.current[stepId]) setRun(stepId, TODO);
        await load(procedure.id);
      },
      reorder: async (order) => {
        if (!procedure) return;
        // Posé tout de suite : un glisser qui revient à sa place le temps de l'appel se lit comme un refus.
        const byId = new Map(procedure.steps.map((step) => [step.id, step]));
        const optimistic = order.map((id) => byId.get(id)).filter((step): step is ProcedureStep => !!step);
        commit({ ...procedure, steps: optimistic });
        try {
          commit(
            await apiPut<Procedure>(`/release-procedures/${procedure.id}/steps/order`, { order, frozen }),
          );
        } catch (error) {
          await load(procedure.id);
          message.error((error as Error).message);
        }
      },
      removeStep: async (stepId) => {
        if (!procedure) return;
        await apiDelete(`/release-procedures/${procedure.id}/steps/${stepId}`);
        await load(procedure.id);
      },
      play: () => void play(),
      validate,
      retry: (stepId) => {
        setRun(stepId, TODO);
        void play();
      },
      skip: (stepId) => {
        setRun(stepId, { state: 'skipped' });
        void play();
      },
      redo: (stepId) => {
        const run = runsRef.current[stepId];
        if (run?.state !== 'done' || !run.redo) return;
        setRun(stepId, { state: 'running' });
        run
          .redo()
          .then((result) => setRun(stepId, result))
          .catch((error: Error) => setRun(stepId, { state: 'failed', error: error.message }));
      },
    }),
    [
      mode,
      procedure,
      hop,
      runs,
      busy,
      frozen,
      defaultPosition,
      shift,
      load,
      commit,
      play,
      validate,
      setRun,
      message,
      t,
    ],
  );

  return (
    <RecorderContext.Provider value={value}>
      {available ? <RecorderLayout>{children}</RecorderLayout> : children}
    </RecorderContext.Provider>
  );
}

/** Colonne à droite sur grand écran, tiroir sur mobile ; contour d'écran pendant l'enregistrement et le rejeu. */
function RecorderLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('reviewTools.recorder');
  const { mode, procedure, runs } = useReleaseRecorder();
  const screens = Grid.useBreakpoint();
  const [drawerOpen, setDrawerOpen] = useState(true);
  const shown = mode !== 'idle' && procedure !== null;
  // Le contour dit « la console agit pour toi » : il s'éteint quand il ne reste plus rien à jouer.
  const replayLeft =
    procedure?.steps.some((step) => !['done', 'skipped'].includes((runs[step.id] ?? TODO).state)) ?? false;
  const framed = mode === 'recording' || (mode === 'playing' && replayLeft);
  const wide = screens.lg !== false;

  useEffect(() => {
    if (mode !== 'idle') setDrawerOpen(true);
  }, [mode]);

  return (
    <>
      {framed && <ScreenFrame tone={mode === 'recording' ? 'recording' : 'playing'} />}
      {shown && wide ? (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
          <aside
            aria-label={t('panelLabel')}
            style={{
              width: PANEL_WIDTH,
              flex: 'none',
              position: 'sticky',
              top: 16,
              maxHeight: 'calc(100vh - 32px)',
              overflowY: 'auto',
              background: 'var(--ant-color-bg-container, #fff)',
              border: '1px solid rgba(5, 5, 5, 0.06)',
              borderRadius: 8,
            }}
          >
            <RecorderPanel />
          </aside>
        </div>
      ) : (
        children
      )}
      {shown && !wide && (
        <>
          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            placement="right"
            width="min(360px, 100vw)"
            closable={false}
            styles={{ body: { padding: 0 } }}
          >
            <RecorderPanel onHide={() => setDrawerOpen(false)} />
          </Drawer>
          {!drawerOpen && (
            <FloatButton
              icon={<OrderedListOutlined />}
              type="primary"
              badge={{ count: procedure.steps.length, color: mode === 'recording' ? 'red' : 'blue' }}
              onClick={() => setDrawerOpen(true)}
              aria-label={t('showPanel')}
            />
          )}
        </>
      )}
    </>
  );
}

const TONES = { recording: '245, 34, 45', playing: '22, 119, 255' } as const;

/** Le contour qui pulse autour de l'écran : on voit d'un coup d'œil que tout ce qu'on fait est capté. */
function ScreenFrame({ tone }: { tone: keyof typeof TONES }) {
  const rgb = TONES[tone];
  return (
    <>
      <style>{`
        @keyframes nwm-recorder-pulse {
          0%, 100% { box-shadow: inset 0 0 0 3px rgba(${rgb}, 0.9), inset 0 0 28px rgba(${rgb}, 0.35); }
          50% { box-shadow: inset 0 0 0 3px rgba(${rgb}, 0.45), inset 0 0 10px rgba(${rgb}, 0.12); }
        }
        @media (prefers-reduced-motion: reduce) {
          .nwm-recorder-frame { animation: none !important; }
        }
      `}</style>
      <div
        aria-hidden
        className="nwm-recorder-frame"
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 2000,
          animation: 'nwm-recorder-pulse 2s ease-in-out infinite',
          boxShadow: `inset 0 0 0 3px rgba(${rgb}, 0.9)`,
        }}
      />
    </>
  );
}
