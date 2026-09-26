'use client';

import React, { useState } from 'react';
import { Button, Typography } from 'antd';
import { useTranslations } from 'next-intl';

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
  const t = useTranslations('chat.switchedResources');
  const [open, setOpen] = useState(false);
  const rows = switched ?? [];
  if (rows.length === 0) {
    if (replacements === 0) return null;
    return <span>{t('replaced', { count: replacements })}</span>;
  }
  const visible = rows.length > 3 && !open ? [] : rows;
  return (
    <div>
      {rows.length > 3 && (
        <Typography.Text>
          {t('switched', { count: rows.length })}{' '}
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setOpen(!open)}>
            {open ? t('hide') : t('which')}
          </Button>
        </Typography.Text>
      )}
      {visible.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {visible.map((row) => (
            <li key={`${row.nodeName}:${row.from}`}>
              {t.rich('row', {
                node: row.nodeName,
                from: row.from,
                to: row.to,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
