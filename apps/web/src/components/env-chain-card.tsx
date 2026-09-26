'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useIsMobile } from './mobile/use-is-mobile';
import { apiGet, apiPut } from '../lib/api';
import { EnvDefinition, PlatformSettings, useEnvs } from '../lib/envs';

/** Les deux bouts : ils ne se suppriment pas, et ne changent pas de place. */
const FIRST_ENV_ID = 'dev';
const PROD_ENV_ID = 'prod';

const COLORS = ['blue', 'green', 'orange', 'red', 'purple', 'cyan', 'magenta', 'gold', 'geekblue'];

/** Un id d'env voyage dans un tag n8n, un suffixe de nom et une URL de webhook. */
function slugifyEnvId(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

/**
 * Les environnements de la maison : lesquels existent, qui dépend de qui, et ce
 * que la plateforme réserve à chacun. dev et prod sont les deux bouts obligatoires ;
 * tout le reste — preprod comprise — s'ajoute, se renomme et se supprime.
 */
const FIELD_KEYS = ['label', 'color', 'after', 'monitored', 'canonicalWebhookPath'] as const;

export function EnvChainCard() {
  const t = useTranslations('settings.envChain');
  const tc = useTranslations('common');
  const mobile = useIsMobile();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [envs, setEnvs] = useState<EnvDefinition[]>([]);
  const [saving, setSaving] = useState(false);
  const { refresh } = useEnvs();

  useEffect(() => {
    apiGet<PlatformSettings>('/settings/platform')
      .then((loaded) => {
        setSettings(loaded);
        setEnvs(loaded.envs);
      })
      .catch((error) => message.error((error as Error).message));
  }, []);

  const save = async (patch: Partial<PlatformSettings>, done: string) => {
    if (!settings) return;
    setSaving(true);
    try {
      const saved = await apiPut<PlatformSettings>('/settings/platform', { ...settings, ...patch });
      setSettings(saved);
      setEnvs(saved.envs);
      // Toute la console lit cette liste : sans ce rappel, les tags gardent les
      // anciennes couleurs et les sélecteurs l'ancien choix jusqu'au rechargement.
      refresh();
      message.success(done);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const edit = (id: string, patch: Partial<EnvDefinition>) =>
    setEnvs((current) =>
      current.map((env) => {
        if (env.id === id) return { ...env, ...patch };
        // Renommer un id emporte ce qui le désigne : sans ça, les envs qui en
        // dépendaient se rattacheraient en silence à leur voisin.
        if (patch.id && env.after === id) return { ...env, after: patch.id };
        return env;
      }),
    );

  const add = () => {
    const id = slugifyEnvId(`env-${envs.length + 1}`);
    const previous = envs[envs.length - 2] ?? envs[0];
    setEnvs((current) => [
      // Le nouvel env se range AVANT la prod : c'est une étape de plus avant la
      // mise en service, pas une étape d'après.
      ...current.slice(0, -1),
      {
        id,
        label: id.toUpperCase(),
        color: COLORS[current.length % COLORS.length],
        monitored: false,
        canonicalWebhookPath: false,
        after: previous?.id ?? FIRST_ENV_ID,
      },
      ...current.slice(-1),
    ]);
  };

  const remove = (id: string) =>
    setEnvs((current) =>
      current
        .filter((env) => env.id !== id)
        // Les envs qui en dépendaient se rattachent à SON amont, sinon ils
        // pointeraient un env qui n'existe plus.
        .map((env) =>
          env.after === id ? { ...env, after: current.find((e) => e.id === id)?.after ?? null } : env,
        ),
    );

  // Un champ par colonne, rendu une seule fois pour le tableau (desktop) et les
  // blocs empilés (mobile) : deux écritures divergeraient à la première retouche.
  const controlWidth = mobile ? 160 : 150;
  const fields: Record<string, (env: EnvDefinition) => React.ReactNode> = {
    id: (env) =>
      env.id === FIRST_ENV_ID || env.id === PROD_ENV_ID ? (
        <Tag color={env.color}>{env.id}</Tag>
      ) : (
        <Input
          value={env.id}
          style={{ width: mobile ? 160 : undefined }}
          onChange={(event) => edit(env.id, { id: slugifyEnvId(event.target.value) })}
          placeholder={t('idPlaceholder')}
        />
      ),
    label: (env) => (
      <Input
        value={env.label}
        style={{ width: mobile ? controlWidth : undefined }}
        onChange={(event) => edit(env.id, { label: event.target.value })}
      />
    ),
    color: (env) => (
      <Select
        value={env.color}
        style={{ width: mobile ? controlWidth : 120 }}
        onChange={(value) => edit(env.id, { color: value })}
        options={COLORS.map((item) => ({ value: item, label: <Tag color={item}>{item}</Tag> }))}
      />
    ),
    after: (env) =>
      env.id === FIRST_ENV_ID ? (
        <Typography.Text type="secondary">{t('root')}</Typography.Text>
      ) : (
        <Select
          value={env.after ?? undefined}
          style={{ width: controlWidth }}
          onChange={(value) => edit(env.id, { after: value })}
          options={envs
            .filter((item) => item.id !== env.id)
            .map((item) => ({ value: item.id, label: item.label }))}
        />
      ),
    monitored: (env) => (
      <Checkbox
        checked={env.monitored}
        onChange={(event) => edit(env.id, { monitored: event.target.checked })}
      />
    ),
    canonicalWebhookPath: (env) => (
      <Checkbox
        checked={env.canonicalWebhookPath}
        onChange={(event) => edit(env.id, { canonicalWebhookPath: event.target.checked })}
      />
    ),
    remove: (env) =>
      env.id === FIRST_ENV_ID || env.id === PROD_ENV_ID ? null : (
        <Popconfirm title={t('removeConfirm')} description={t('removeHint')} onConfirm={() => remove(env.id)}>
          <Button type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
  };

  const mode = settings?.envChainMode ?? 'warn';
  const dirty = JSON.stringify(envs) !== JSON.stringify(settings?.envs ?? []);
  const duplicated = new Set(envs.map((env) => env.id)).size !== envs.length;

  return (
    <Card size="small" title={t('title')} style={{ marginBottom: 16 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* Sept colonnes de champs éditables : en tableau, elles sortent de l'écran d'un
            téléphone. Mêmes champs, empilés par environnement. */}
        {mobile ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {envs.map((env) => (
              <Card key={env.id} size="small" style={{ background: 'transparent' }}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                    {fields.id(env)}
                    {fields.remove(env)}
                  </Space>
                  {FIELD_KEYS.map((key) => (
                    <Space key={key} style={{ justifyContent: 'space-between', width: '100%' }}>
                      <Typography.Text type="secondary">{t(`columns.${key}`)}</Typography.Text>
                      {fields[key](env)}
                    </Space>
                  ))}
                </Space>
              </Card>
            ))}
          </Space>
        ) : (
          <Table<EnvDefinition> dataSource={envs} rowKey="id" size="small" pagination={false}>
            <Table.Column<EnvDefinition>
              title={<Tooltip title={t('idTooltip', { tag: 'env:<id>' })}>{t('columns.id')}</Tooltip>}
              dataIndex="id"
              width={200}
              render={(_: string, env) => fields.id(env)}
            />
            <Table.Column<EnvDefinition>
              title={t('columns.label')}
              dataIndex="label"
              width={180}
              render={(_: string, env) => fields.label(env)}
            />
            <Table.Column<EnvDefinition>
              title={t('columns.color')}
              dataIndex="color"
              width={140}
              render={(_: string, env) => fields.color(env)}
            />
            <Table.Column<EnvDefinition>
              title={<Tooltip title={t('afterTooltip')}>{t('columns.after')}</Tooltip>}
              dataIndex="after"
              width={180}
              render={(_: string | null, env) => fields.after(env)}
            />
            <Table.Column<EnvDefinition>
              title={<Tooltip title={t('monitoredTooltip')}>{t('columns.monitored')}</Tooltip>}
              dataIndex="monitored"
              width={110}
              render={(_: boolean, env) => fields.monitored(env)}
            />
            <Table.Column<EnvDefinition>
              title={<Tooltip title={t('canonicalTooltip')}>{t('columns.canonicalWebhookPath')}</Tooltip>}
              dataIndex="canonicalWebhookPath"
              width={120}
              render={(_: boolean, env) => fields.canonicalWebhookPath(env)}
            />
            <Table.Column<EnvDefinition> width={60} render={(_, env) => fields.remove(env)} />
          </Table>
        )}

        <Space>
          <Button icon={<PlusOutlined />} onClick={add} disabled={saving}>
            {t('add')}
          </Button>
          <Button
            type="primary"
            disabled={!dirty || duplicated || saving}
            loading={saving}
            onClick={() => save({ envs }, t('saved'))}
          >
            {tc('save')}
          </Button>
          {dirty && (
            <Button type="text" disabled={saving} onClick={() => setEnvs(settings?.envs ?? [])}>
              {tc('cancel')}
            </Button>
          )}
          {duplicated && <Typography.Text type="danger">{t('duplicatedId')}</Typography.Text>}
        </Space>

        <div>
          <Typography.Text strong>{t('skipTitle')}</Typography.Text>
          <div style={{ margin: '8px 0' }}>
            <Radio.Group
              value={mode}
              disabled={saving || settings === null}
              onChange={(event) => save({ envChainMode: event.target.value }, t('modeSaved'))}
            >
              <Radio value="warn">{t('modeWarn')}</Radio>
              <Radio value="block">{t('modeBlock')}</Radio>
            </Radio.Group>
          </div>
        </div>

        {mode === 'block' && <Alert type="warning" showIcon message={t('blockHint')} />}
      </Space>
    </Card>
  );
}
