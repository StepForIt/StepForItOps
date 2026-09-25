'use client';

import React from 'react';
import { Select, Tooltip, theme } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import { useInstanceScope } from '../lib/instance-scope';

/**
 * Premier élément du menu latéral : sélecteur du scope d'instance
 * (« Toutes les instances » ou une seule), appliqué à toutes les listes.
 */
export function InstanceScopeMenuItem({ collapsed }: { collapsed: boolean }) {
  const { token } = theme.useToken();
  const { scope, setScope, instances, instanceName } = useInstanceScope();

  if (collapsed) {
    return (
      <Tooltip placement="right" title={`Instance : ${scope ? instanceName(scope) : 'toutes'}`}>
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <ApiOutlined style={{ color: scope ? token.colorPrimary : token.colorTextSecondary }} />
        </div>
      </Tooltip>
    );
  }

  return (
    // stopPropagation : sans ça le Menu antd intercepte flèches/Entrée pendant la saisie dans le Select
    <div
      style={{ padding: '8px 12px 4px' }}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <Select
        style={{ width: '100%' }}
        value={scope ?? 'all'}
        onChange={(value) => setScope(value === 'all' ? null : value)}
        options={[
          { value: 'all', label: 'Toutes les instances' },
          ...instances.map((instance) => ({ value: instance.id, label: instance.name })),
        ]}
      />
    </div>
  );
}
