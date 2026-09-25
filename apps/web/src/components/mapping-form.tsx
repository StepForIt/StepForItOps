'use client';

import React, { useState } from 'react';
import { Button, Form, Input, Select, Space, Tag, Typography } from 'antd';
import type { FormProps } from 'antd';
import { DeleteOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { DiscoveredItem, ResourceDiscoveryBrowser } from './resource-discovery-browser';
import { EnvDefinition, useEnvs } from '../lib/envs';

/**
 * Une ligne du mapping : un nom, et sa valeur PAR env déclaré. Les valeurs sont
 * rangées sous `v` (et les libellés sous `l`) plutôt qu'à plat : un env peut
 * s'appeler « key », et une colonne écraserait alors le nom de la ligne.
 */
interface MappingRow {
  key: string;
  v?: Record<string, string | undefined>;
  l?: Record<string, string | undefined>;
}

type EnvMap = Record<string, Record<string, string>>;

/** {dev: {baseId: "a"}, prod: {baseId: "b"}} → [{key: "baseId", v: {dev: "a", prod: "b"}}] */
function valuesToRows(values?: EnvMap, labels?: EnvMap): MappingRow[] {
  if (!values) return [{ key: '' }];
  const keys = new Set<string>();
  // Toutes les colonnes du mapping, y compris celles d'un env qu'on ne déclare plus :
  // les masquer donnerait un enregistrement qui EFFACE une valeur sans le dire.
  for (const env of Object.keys(values)) Object.keys(values[env] ?? {}).forEach((k) => keys.add(k));
  const rows = [...keys].map((key) => ({
    key,
    v: Object.fromEntries(Object.entries(values).map(([env, ids]) => [env, ids?.[key]])),
    l: Object.fromEntries(Object.entries(labels ?? {}).map(([env, names]) => [env, names?.[key]])),
  }));
  return rows.length > 0 ? rows : [{ key: '' }];
}

/**
 * Nom de chaque ligne. Il ne sert QU'à apparier les envs entre eux — rien dans
 * n8n ne s'y compare, aucun écran ne l'affiche —, donc une ligne laissée sans nom
 * en reçoit un plutôt que d'être refusée : demander d'inventer une clé pour un
 * usage interne, c'est faire porter à l'utilisateur un détail de stockage.
 */
function keysOf(rows: MappingRow[]): string[] {
  const taken = new Set((rows ?? []).map((row) => row?.key?.trim()).filter(Boolean) as string[]);
  let counter = 0;
  return (rows ?? []).map((row) => {
    const named = row?.key?.trim();
    if (named) return named;
    let candidate = '';
    do {
      counter += 1;
      candidate = `ligne_${counter}`;
    } while (taken.has(candidate));
    taken.add(candidate);
    return candidate;
  });
}

/** [{v: {dev: "a"}}] → {dev: {ligne_1: "a"}} — même découpage pour les ids et les libellés. */
function collect(rows: MappingRow[], field: 'v' | 'l'): EnvMap {
  const out: EnvMap = {};
  const keys = keysOf(rows);
  (rows ?? []).forEach((row, index) => {
    for (const [env, raw] of Object.entries(row?.[field] ?? {})) {
      const value = raw?.trim();
      if (!value) continue;
      out[env] = { ...(out[env] ?? {}), [keys[index]]: value };
    }
  });
  return out;
}

/** Bouton + drawer de découverte : injecte les ids trouvés sur n8n dans les lignes du mapping. */
function DiscoveryPicker() {
  const form = Form.useFormInstance();
  const provider = Form.useWatch<string | undefined>('provider', form);
  const [open, setOpen] = useState(false);

  const pick = (item: DiscoveredItem, env: string) => {
    const rows: MappingRow[] = (form.getFieldValue('rows') ?? []).filter(
      (row: MappingRow | undefined) => row && (row.key?.trim() || Object.values(row.v ?? {}).some(Boolean)),
    );
    const index = rows.findIndex((row) => row.key?.trim() === item.suggestedKey);
    // Le nom est capté ICI, seul endroit où on l'a : après coup, le JSON n8n ne
    // porte que des ids et le vrai titre vit chez le provider.
    const current = index >= 0 ? rows[index] : { key: item.suggestedKey };
    const merged: MappingRow = {
      ...current,
      v: { ...(current.v ?? {}), [env]: item.id },
      l: { ...(current.l ?? {}), [env]: item.name },
    };
    if (index >= 0) rows[index] = merged;
    else rows.push(merged);
    form.setFieldsValue({ rows: [...rows] });
  };

  return (
    <>
      <Button icon={<SearchOutlined />} onClick={() => setOpen(true)}>
        Parcourir depuis n8n
      </Button>
      <ResourceDiscoveryBrowser
        open={open}
        provider={provider}
        onClose={() => setOpen(false)}
        onPick={pick}
      />
    </>
  );
}

/** Formulaire mapping : une ligne par ressource à basculer, une colonne par env déclaré. */
export function MappingForm({ formProps }: { formProps: FormProps }) {
  const { envs } = useEnvs();
  const initialValues = (formProps.initialValues?.values ?? undefined) as EnvMap | undefined;
  // Un env retiré des réglages dont le mapping porte encore des valeurs : la colonne
  // reste, marquée, plutôt que de disparaître avec ce qu'elle contient.
  const extras: EnvDefinition[] = Object.keys(initialValues ?? {})
    .filter((env) => !envs.some((declared) => declared.id === env))
    .map((env) => ({
      id: env,
      label: `${env.toUpperCase()} (non déclaré)`,
      color: 'default',
      monitored: false,
      canonicalWebhookPath: false,
      after: null,
    }));
  const columns = [...envs, ...extras];

  return (
    <Form
      {...formProps}
      layout="vertical"
      initialValues={{
        ...formProps.initialValues,
        rows: valuesToRows(initialValues, formProps.initialValues?.labels),
      }}
      onFinish={(raw: { provider: string; logicalName: string; rows: MappingRow[] }) => {
        const labels = collect(raw.rows, 'l');
        formProps.onFinish?.({
          provider: raw.provider,
          logicalName: raw.logicalName,
          values: collect(raw.rows, 'v'),
          labels: Object.keys(labels).length > 0 ? labels : undefined,
        });
      }}
    >
      <Space size="large" wrap>
        <Form.Item label="Provider" name="provider" rules={[{ required: true }]} style={{ minWidth: 200 }}>
          <Select
            options={['airtable', 'google-sheets', 'notion', 'nocodb', 'postgres', 'credential'].map((p) => ({
              value: p,
              label: p,
            }))}
          />
        </Form.Item>
        <Form.Item
          label="Nom logique"
          name="logicalName"
          rules={[{ required: true }]}
          style={{ minWidth: 260 }}
        >
          <Input placeholder="CRM principal" />
        </Form.Item>
        <Form.Item label="Découverte" colon={false}>
          <DiscoveryPicker />
        </Form.Item>
      </Space>

      <Typography.Paragraph type="secondary">
        Une ligne par identifiant à basculer (base, table, credential…). Laisse vide les envs non concernés —
        le remplacement se fait entre les valeurs d&apos;une même ligne. Le nom de la ligne ne sert qu&apos;à
        s&apos;y retrouver : rien dans n8n ne s&apos;y compare, et laissé vide il est rempli tout seul.
      </Typography.Paragraph>

      <Form.List name="rows">
        {(fields, { add, remove }) => (
          <>
            <Space style={{ marginBottom: 4, fontWeight: 600 }}>
              <span style={{ display: 'inline-block', width: 180 }}>Nom de la ligne</span>
              {columns.map((env) => (
                <span key={env.id} style={{ display: 'inline-block', width: 220 }}>
                  <Tag color={env.color}>{env.label}</Tag>
                </span>
              ))}
            </Space>
            {fields.map((field) => (
              <Space key={field.key} align="baseline" style={{ display: 'flex' }}>
                {/* Grille dense sous un en-tête de colonnes : le libellé de chaque
                    input est porté par aria-label, la colonne le rappelant à l'œil. */}
                <Form.Item name={[field.name, 'key']}>
                  <Input aria-label="Nom de la ligne" placeholder="facultatif" style={{ width: 180 }} />
                </Form.Item>
                {columns.map((env) => (
                  <Form.Item key={env.id} name={[field.name, 'v', env.id]}>
                    <Input
                      aria-label={`Identifiant ${env.label}`}
                      placeholder={`app${env.id.toUpperCase()}…`}
                      style={{ width: 220 }}
                    />
                  </Form.Item>
                ))}
                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
              </Space>
            ))}
            <Button icon={<PlusOutlined />} onClick={() => add({ key: '' })}>
              Ajouter un champ
            </Button>
          </>
        )}
      </Form.List>
    </Form>
  );
}
