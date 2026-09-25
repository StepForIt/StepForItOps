'use client';

import React, { useEffect, useState } from 'react';
import { Empty, List, Select, Space, Spin, Tag, Typography } from 'antd';
import { apiGet } from '../lib/api';

interface CredentialUsage {
  workflowId: string;
  workflowName: string;
  nodeNames: string[];
}

interface HarvestedCredential {
  type: string;
  id: string;
  name?: string;
  usedBy: number;
  usages: CredentialUsage[];
}

/** Credentials utilisés par les workflows d'un groupe, avec le détail workflow → nœuds. */
export function GroupCredentials({ groupId }: { groupId: string }) {
  const [credentials, setCredentials] = useState<HarvestedCredential[] | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>();

  useEffect(() => {
    setCredentials(null);
    apiGet<HarvestedCredential[]>(`/resource-discovery/credentials?groupId=${encodeURIComponent(groupId)}`)
      .then(setCredentials)
      .catch(() => setCredentials([]));
  }, [groupId]);

  if (credentials === null) return <Spin />;
  if (credentials.length === 0) {
    return <Empty description="Aucun credential dans les workflows de ce groupe" />;
  }

  const types = [...new Set(credentials.map((c) => c.type))].sort();
  const visible = typeFilter ? credentials.filter((c) => c.type === typeFilter) : credentials;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <Select
        allowClear
        placeholder="Filtrer par type"
        style={{ minWidth: 240 }}
        value={typeFilter}
        onChange={setTypeFilter}
        options={types.map((t) => ({ value: t, label: t }))}
      />
      <List
        size="small"
        dataSource={visible}
        renderItem={(credential) => (
          <List.Item>
            <List.Item.Meta
              title={
                <Space wrap>
                  <Tag>{credential.type}</Tag>
                  {credential.name ?? credential.id}
                  <Typography.Text type="secondary">
                    {credential.usedBy} nœud{credential.usedBy > 1 ? 's' : ''}
                  </Typography.Text>
                </Space>
              }
              description={
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Typography.Text code copyable={{ text: credential.id }}>
                    {credential.id}
                  </Typography.Text>
                  {credential.usages.map((usage) => (
                    <Typography.Text key={usage.workflowId} type="secondary">
                      {usage.workflowName} — {usage.nodeNames.join(', ')}
                    </Typography.Text>
                  ))}
                </Space>
              }
            />
          </List.Item>
        )}
      />
    </Space>
  );
}
