'use client';

import React, { useEffect, useRef, useState } from 'react';
import { DeleteButton, List } from '@refinedev/antd';
import { useTranslations } from 'next-intl';
import { useTable } from '../../lib/list-memory/use-list-memory';
import { App, Button, Form, Input, InputRef, Modal, Select, Space, Typography } from 'antd';
import { CopyOutlined, EyeOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { Table } from '../../components/resizable-table';
import { useReleaseRecorder } from '../../components/release-recorder/release-recorder';
import type { Procedure } from '../../components/release-recorder/types';
import { apiPost } from '../../lib/api';
import { EnvDefinition, useEnvs, useEnvOptions } from '../../lib/envs';

export default function ProceduresPage() {
  const t = useTranslations('misc.procedures');
  const tc = useTranslations('common');
  const recorder = useReleaseRecorder();
  const { tableProps, tableQuery } = useTable<Procedure>({
    resource: 'release-procedures',
    pagination: { mode: 'off' },
    syncWithLocation: false,
  });
  const [naming, setNaming] = useState(false);
  const [replaying, setReplaying] = useState<Procedure | null>(null);
  const [copying, setCopying] = useState<Procedure | null>(null);
  const recording = recorder.mode === 'recording';
  const { refetch } = tableQuery;

  // La liste suit l'enregistreur : une étape captée ou un arrêt se voient sans recharger.
  useEffect(() => {
    void refetch();
  }, [recorder.mode, recorder.procedure?.steps.length, refetch]);

  return (
    <List
      title={t('title')}
      headerButtons={
        <Button type="primary" danger={!recording} disabled={recording} onClick={() => setNaming(true)}>
          {recording ? t('recordingInProgress') : t('record')}
        </Button>
      }
    >
      <Table {...tableProps} rowKey="id" pagination={false}>
        <Table.Column<Procedure> dataIndex="name" title={t('name')} />
        <Table.Column<Procedure>
          title={t('steps')}
          render={(_, row) => {
            const manual = row.steps.filter((step) => step.kind === 'manual').length;
            return manual ? t('stepsWithManual', { count: row.steps.length, manual }) : row.steps.length;
          }}
        />
        <Table.Column<Procedure>
          title={t('recorded')}
          render={(_, row) =>
            row.status === 'recording' ? (
              <Typography.Text type="danger">{t('inProgress')}</Typography.Text>
            ) : row.sourceEnv && row.targetEnv ? (
              `${row.sourceEnv.toUpperCase()} → ${row.targetEnv.toUpperCase()}`
            ) : (
              '—'
            )
          }
        />
        <Table.Column<Procedure>
          title=""
          render={(_, row) => (
            <Space>
              <Button
                size="small"
                icon={<PlayCircleOutlined />}
                disabled={recording || row.status === 'recording' || row.steps.length === 0}
                onClick={() => setReplaying(row)}
              >
                {t('replay')}
              </Button>
              <Button
                size="small"
                icon={<CopyOutlined />}
                disabled={row.status === 'recording' || !row.sourceEnv || !row.targetEnv}
                onClick={() => setCopying(row)}
                aria-label={t('duplicateTo')}
                title={t('duplicateTo')}
              />
              <Button
                size="small"
                icon={<EyeOutlined />}
                disabled={recording}
                onClick={() => recorder.open(row.id)}
                aria-label={tc('see')}
              />
              <DeleteButton
                size="small"
                hideText
                recordItemId={row.id}
                disabled={row.status === 'recording'}
              />
            </Space>
          )}
        />
      </Table>
      <StartModal open={naming} onClose={() => setNaming(false)} />
      <ReplayModal procedure={replaying} onClose={() => setReplaying(null)} />
      <DuplicateModal
        procedure={copying}
        onClose={() => setCopying(null)}
        onDone={() => {
          setCopying(null);
          void refetch();
        }}
      />
    </List>
  );
}

function StartModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('misc.procedures');
  const recorder = useReleaseRecorder();
  const [form] = Form.useForm<{ name: string }>();
  const [loading, setLoading] = useState(false);
  // `autoFocus` part avant la fin de l'animation d'ouverture et se perd : on focalise après.
  const input = useRef<InputRef>(null);

  const submit = async ({ name }: { name: string }) => {
    setLoading(true);
    try {
      await recorder.startRecording(name);
      form.resetFields();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('start.title')}
      okText={t('start.ok')}
      onOk={form.submit}
      onCancel={onClose}
      confirmLoading={loading}
      afterOpenChange={(visible) => visible && input.current?.focus()}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item
          name="name"
          label={t('name')}
          rules={[{ required: true, message: t('start.nameRequired') }]}
        >
          <Input ref={input} placeholder={t('start.placeholder')} onPressEnter={form.submit} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Recopie de `nextHop` (`@nwm/core`) : le premier env déclaré qui dépend de celui-ci. */
function nextEnv(envs: EnvDefinition[], from: string | undefined): string | undefined {
  return envs.find((env) => env.after === from && env.id !== from)?.id;
}

/**
 * Le saut proposé par défaut : un cran plus loin (dev → preprod enregistré propose preprod → prod) ;
 * au bout de la chaîne, le saut enregistré lui-même — celui d'une copie « mise en prod ».
 */
function defaultHop(procedure: Procedure, envs: EnvDefinition[]): { source?: string; target?: string } {
  const from = procedure.targetEnv ?? undefined;
  const next = nextEnv(envs, from);
  if (next || !procedure.sourceEnv) return { source: from, target: next };
  return { source: procedure.sourceEnv, target: from };
}

/** Rejouer, par défaut, un cran plus loin (cf. `defaultHop`). */
function ReplayModal({ procedure, onClose }: { procedure: Procedure | null; onClose: () => void }) {
  const t = useTranslations('misc.procedures');
  const recorder = useReleaseRecorder();
  const { envs } = useEnvs();
  const options = useEnvOptions();
  const [source, setSource] = useState<string>();
  const [target, setTarget] = useState<string>();

  useEffect(() => {
    if (!procedure) return;
    const hop = defaultHop(procedure, envs);
    setSource(hop.source);
    setTarget(hop.target);
  }, [procedure, envs]);

  const ok = async () => {
    if (!procedure || !source || !target) return;
    await recorder.open(procedure.id, { source, target });
    onClose();
  };

  return (
    <Modal
      open={procedure !== null}
      title={procedure ? t('replayModal.title', { name: procedure.name }) : ''}
      okText={t('replayModal.ok')}
      okButtonProps={{ disabled: !source || !target || source === target }}
      onOk={ok}
      onCancel={onClose}
      destroyOnClose
    >
      {procedure && (!procedure.sourceEnv || !procedure.targetEnv) ? (
        <Typography.Text type="warning">{t('replayModal.noHop')}</Typography.Text>
      ) : null}
      <Space style={{ marginTop: 8 }}>
        <Select
          style={{ width: 140 }}
          value={source}
          onChange={setSource}
          options={options}
          aria-label={t('from')}
        />
        →
        <Select
          style={{ width: 140 }}
          value={target}
          onChange={setTarget}
          options={options}
          aria-label={t('to')}
        />
      </Space>
    </Modal>
  );
}

/** Copie la procédure sur un autre saut : une procédure à part, qui se rejoue et s'édite seule. */
function DuplicateModal({
  procedure,
  onClose,
  onDone,
}: {
  procedure: Procedure | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('misc.procedures');
  const { message } = App.useApp();
  const { envs } = useEnvs();
  const options = useEnvOptions();
  const [source, setSource] = useState<string>();
  const [target, setTarget] = useState<string>();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!procedure) return;
    const from = procedure.targetEnv ?? undefined;
    setSource(from);
    setTarget(nextEnv(envs, from));
    setName('');
  }, [procedure, envs]);

  const same = procedure?.sourceEnv === source && procedure?.targetEnv === target;
  const hop = source && target ? `${source.toUpperCase()} → ${target.toUpperCase()}` : '';

  const ok = async () => {
    if (!procedure || !source || !target) return;
    setLoading(true);
    try {
      const copy = await apiPost<Procedure>(`/release-procedures/${procedure.id}/duplicate`, {
        sourceEnv: source,
        targetEnv: target,
        name: name.trim() || undefined,
      });
      message.success(t('duplicateModal.created', { name: copy.name }));
      onDone();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={procedure !== null}
      title={procedure ? t('duplicateModal.title', { name: procedure.name }) : ''}
      okText={t('duplicateModal.ok')}
      okButtonProps={{ disabled: !source || !target || source === target || same }}
      confirmLoading={loading}
      onOk={ok}
      onCancel={onClose}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space>
          <Select
            style={{ width: 140 }}
            value={source}
            onChange={setSource}
            options={options}
            aria-label={t('from')}
          />
          →
          <Select
            style={{ width: 140 }}
            value={target}
            onChange={setTarget}
            options={options}
            aria-label={t('to')}
          />
        </Space>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={procedure && hop ? `${procedure.name} (${hop})` : t('name')}
          aria-label={t('name')}
        />
        {same ? <Typography.Text type="secondary">{t('duplicateModal.same')}</Typography.Text> : null}
      </Space>
    </Modal>
  );
}
