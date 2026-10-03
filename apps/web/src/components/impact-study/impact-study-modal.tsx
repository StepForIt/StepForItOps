'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Collapse, Modal, Select, Space, Spin, Tag, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../lib/api';
import { useEnvLabel, useEnvOptions } from '../../lib/envs';
import { ImpactDetail, ImpactHeader, ImpactList, ImpactSummaryBar, sortByLevel } from './impact-study-view';
import type { ImpactStudy, ProcedureImpactStudy } from './types';

/** Ce qu'on étudie : un ou plusieurs workflows, ou le rejeu d'une procédure sur un saut. */
export type ImpactSubject =
  | { kind: 'workflows'; ids: string[]; title?: string }
  | { kind: 'procedure'; id: string; name: string; source?: string; target?: string };

/** L'étude ne lit rien dans n8n : l'ouvrir ne coûte rien, la rouvrir non plus. */
export function ImpactStudyModal({
  subject,
  onClose,
}: {
  subject: ImpactSubject | null;
  onClose: () => void;
}) {
  const t = useTranslations('misc.impactStudy');
  return (
    <Modal
      open={subject !== null}
      title={
        subject?.kind === 'procedure'
          ? t('titleProcedure', { name: subject.name })
          : subject?.title
            ? t('titleOne', { name: subject.title })
            : t('titleMany', { count: subject?.ids.length ?? 0 })
      }
      onCancel={onClose}
      footer={null}
      width={820}
      destroyOnClose
    >
      {subject?.kind === 'workflows' && <WorkflowsStudy ids={subject.ids} />}
      {subject?.kind === 'procedure' && (
        <ProcedureStudy id={subject.id} source={subject.source} target={subject.target} />
      )}
    </Modal>
  );
}

function useStudy<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    setState((current) => ({ ...current, loading: true, error: undefined }));
    load()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((error: Error) => alive && setState({ error: error.message, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function WorkflowsStudy({ ids }: { ids: string[] }) {
  const key = ids.join(',');
  const { data, error, loading } = useStudy<ImpactStudy>(
    () =>
      ids.length === 1
        ? apiGet<ImpactStudy>(`/impact-study/workflows/${ids[0]}`)
        : apiPost<ImpactStudy>('/impact-study/workflows', { ids }),
    [key],
  );
  if (loading) return <Spin style={{ display: 'block', margin: '32px auto' }} />;
  if (error || !data) return <Alert type="error" showIcon message={error} />;
  return (
    <>
      <ImpactSummaryBar summary={data.summary} windowDays={data.windowDays} />
      <ImpactList items={data.items} />
    </>
  );
}

function ProcedureStudy({ id, source, target }: { id: string; source?: string; target?: string }) {
  const t = useTranslations('misc.impactStudy');
  const envLabel = useEnvLabel();
  const options = useEnvOptions();
  const [hop, setHop] = useState({ source, target });
  const query =
    hop.source && hop.target
      ? `?sourceEnv=${encodeURIComponent(hop.source)}&targetEnv=${encodeURIComponent(hop.target)}`
      : '';
  const { data, error, loading } = useStudy<ProcedureImpactStudy>(
    () => apiGet<ProcedureImpactStudy>(`/impact-study/procedures/${id}${query}`),
    [id, query],
  );

  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Typography.Text type="secondary">{t('procedure.hop')}</Typography.Text>
        <Select
          style={{ width: 140 }}
          value={hop.source ?? data?.hop?.source}
          onChange={(value) => setHop((current) => ({ ...current, source: value }))}
          options={options}
          aria-label={t('procedure.from')}
        />
        →
        <Select
          style={{ width: 140 }}
          value={hop.target ?? data?.hop?.target}
          onChange={(value) => setHop((current) => ({ ...current, target: value }))}
          options={options}
          aria-label={t('procedure.to')}
        />
      </Space>
      {loading && <Spin style={{ display: 'block', margin: '32px auto' }} />}
      {!loading && (error || !data) && <Alert type="error" showIcon message={error} />}
      {!loading && data && (
        <>
          <ImpactSummaryBar summary={data.summary} windowDays={data.windowDays} />
          {data.targets.length === 0 ? (
            <Typography.Text type="secondary">{t('procedure.nothing')}</Typography.Text>
          ) : (
            <Collapse
              items={sortByLevel(data.targets).map((target) => {
                const role = (
                  <Tag
                    color={target.role === 'write' ? 'orange' : target.role === 'run' ? 'blue' : undefined}
                  >
                    {t(`procedure.role.${target.role}`)} ·{' '}
                    {t('procedure.steps', { steps: target.stepPositions.join(', ') })}
                  </Tag>
                );
                return {
                  key: `${target.familyKey}@${target.env}`,
                  label: target.impact ? (
                    <ImpactHeader impact={target.impact} extra={role} />
                  ) : (
                    <Space wrap size={6}>
                      <Typography.Text strong>{target.familyName}</Typography.Text>
                      <Tag>{envLabel(target.env)}</Tag>
                      {role}
                    </Space>
                  ),
                  children: target.impact ? (
                    <ImpactDetail impact={target.impact} />
                  ) : (
                    <Typography.Text type="secondary">{target.note}</Typography.Text>
                  ),
                };
              })}
            />
          )}
        </>
      )}
    </>
  );
}
