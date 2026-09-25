'use client';

import React, { useState } from 'react';
import { Button, Typography } from 'antd';

export interface SwitchedResource {
  nodeName: string;
  from: string;
  to: string;
}

/**
 * Les ressources qu'une bascule remplace, nommées « nœud : avant → après ». Un
 * id sans libellé n'a pas de nom à montrer : on retombe alors sur le compte.
 */
export function SwitchedResources({
  switched,
  replacements,
}: {
  switched?: SwitchedResource[];
  replacements: number;
}) {
  const [open, setOpen] = useState(false);
  const rows = switched ?? [];
  if (rows.length === 0) {
    if (replacements === 0) return null;
    return <span>{replacements} base(s)/table(s) remplacée(s)</span>;
  }
  const visible = rows.length > 3 && !open ? [] : rows;
  return (
    <div>
      {rows.length > 3 && (
        <Typography.Text>
          {rows.length} ressources basculées{' '}
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setOpen(!open)}>
            {open ? 'masquer' : 'lesquelles ?'}
          </Button>
        </Typography.Text>
      )}
      {visible.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {visible.map((row) => (
            <li key={`${row.nodeName}:${row.from}`}>
              {row.nodeName} : {row.from} → <strong>{row.to}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
