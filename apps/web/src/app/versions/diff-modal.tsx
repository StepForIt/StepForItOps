'use client';

import React from 'react';
import { Alert, Descriptions, Modal, Skeleton, Tag, Space, Typography } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet } from '../../lib/api';
import { DiffCounts, WorkflowDiff, WorkflowDiffView } from '../../components/workflow-diff-view';

interface VersionRef {
  id: string;
  hash: string;
  createdAt: string;
  origin: string;
}

interface VersionDiff {
  version: VersionRef;
  previous: VersionRef | null;
  workflow: { id: string; name: string };
  diff: WorkflowDiff | null;
}

/**
 * Ce qu'une version a changé par rapport à la précédente. C'est la question
 * qu'on se pose devant l'historique — « pourquoi une version de plus ? » — et à
 * laquelle deux empreintes côte à côte ne répondent pas : une version peut
 * n'être qu'un réglage déplacé, comme une refonte de dix nœuds.
 */
export function VersionDiffModal({ versionId, onClose }: { versionId: string | null; onClose: () => void }) {
  const t = useTranslations('inventory.versions.diff');
  const locale = useLocale();
  const fr = (iso: string) => new Date(iso).toLocaleString(locale);
  const [data, setData] = React.useState<VersionDiff | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setData(null);
    setError(null);
    if (!versionId) return;
    setLoading(true);
    apiGet<VersionDiff>(`/versions/${versionId}/diff`)
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [versionId]);

  return (
    <Modal
      title={data ? t('title', { name: data.workflow.name }) : t('titleLoading')}
      open={versionId !== null}
      onCancel={onClose}
      footer={null}
      width={860}
    >
      {loading && <Skeleton active />}
      {error && <Alert type="error" showIcon message={error} />}

      {data && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label={t('version')}>
              {fr(data.version.createdAt)} <Tag>{data.version.origin}</Tag>
              <br />
              <code>{data.version.hash.slice(0, 10)}</code>
            </Descriptions.Item>
            <Descriptions.Item label={t('comparedTo')}>
              {data.previous ? (
                <>
                  {fr(data.previous.createdAt)} <Tag>{data.previous.origin}</Tag>
                  <br />
                  <code>{data.previous.hash.slice(0, 10)}</code>
                </>
              ) : (
                <Typography.Text type="secondary">{t('noPrevious')}</Typography.Text>
              )}
            </Descriptions.Item>
          </Descriptions>

          {data.diff && !data.diff.hasChanges && <Alert type="warning" showIcon message={t('noChange')} />}

          {data.diff?.nameChange && (
            <Alert
              type="warning"
              showIcon
              message={t('rename', {
                before: data.diff.nameChange.before,
                after: data.diff.nameChange.after,
              })}
            />
          )}

          {data.diff?.hasChanges && (
            <>
              <DiffCounts counts={data.diff.counts} />
              <WorkflowDiffView diff={data.diff} />
            </>
          )}
        </Space>
      )}
    </Modal>
  );
}
