'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Empty, InputNumber, Space, Tag, message } from 'antd';
import { Table } from './resizable-table';
import { apiGet } from '../lib/api';

interface NodeSamples {
  node: string;
  executions: number;
  items: number;
  fields: string[];
}

interface SamplesResponse {
  samples: NodeSamples[];
  sampledExecutions: number;
}

/**
 * Ce que les nœuds ont VRAIMENT sorti lors des dernières exécutions : la matière
 * que `field-checker` compare aux champs lus par les expressions (`$json.foo`),
 * d'où les findings `field-typo` et `field-unknown`. On la consulte pour
 * répondre à « qu'est-ce que ce nœud renvoie, en vrai ? ».
 */
export function ExecutionSamplesPanel({
  workflowId,
  active = true,
}: {
  workflowId: string;
  active?: boolean;
}) {
  const [data, setData] = useState<SamplesResponse | null>(null);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<SamplesResponse>(`/field-checker/samples/${workflowId}?limit=${limit}`)
      .then(setData)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [workflowId, limit]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="Ce que chaque nœud a vraiment renvoyé"
        description={
          <>
            Relevé sur les dernières exécutions de ce workflow. Sert à deux choses : répondre à «{' '}
            <i>qu&apos;est-ce que ce nœud sort, en vrai ?</i> » quand on écrit une expression, et alimenter
            les contrôles « Champs » — une expression qui lit un champ absent d&apos;ici remonte en finding (
            <code>field-unknown</code>), un champ mal orthographié aussi (<code>field-typo</code>).
          </>
        }
      />
      <Space wrap>
        <span>Exécutions échantillonnées :</span>
        <InputNumber min={1} max={100} value={limit} onChange={(v) => setLimit(v ?? 10)} />
        {data && data.sampledExecutions !== limit && (
          <Tag>{data.sampledExecutions} exécution(s) exploitée(s)</Tag>
        )}
      </Space>
      <Table
        dataSource={data?.samples ?? []}
        rowKey="node"
        loading={loading}
        size="small"
        pagination={false}
        scroll={{ y: 420 }}
        locale={{
          emptyText: <Empty description="Aucune exécution exploitable." />,
        }}
      >
        <Table.Column<NodeSamples> dataIndex="node" title="Nœud" width={220} />
        <Table.Column<NodeSamples>
          title="Échantillon"
          width={140}
          render={(_, record) => `${record.items} items / ${record.executions} exéc.`}
        />
        <Table.Column<NodeSamples>
          dataIndex="fields"
          title="Champs"
          render={(fields: string[]) => (
            <Space size={[4, 4]} wrap>
              {fields.map((field) => (
                <Tag key={field} style={{ margin: 0 }}>
                  {field}
                </Tag>
              ))}
            </Space>
          )}
        />
      </Table>
    </Space>
  );
}
