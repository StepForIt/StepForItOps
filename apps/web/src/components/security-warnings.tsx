'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert } from 'antd';

/**
 * Bannière d'avertissement quand la plateforme tourne sans protection :
 * pas d'authentification front, API sans jeton, ou secret de session absent.
 * Volontairement bruyante — une install de prod correctement configurée ne la
 * voit jamais, et en dev local elle rappelle que tout est ouvert.
 */

const MESSAGES = {
  'auth-open': 'authOpen',
  'api-open': 'apiOpen',
  'no-session-secret': 'noSessionSecret',
} as const;

function isKnown(code: string): code is keyof typeof MESSAGES {
  return code in MESSAGES;
}

export function SecurityWarnings() {
  const t = useTranslations('shell.securityWarnings');
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/security-status')
      .then((res) => (res.ok ? res.json() : { warnings: [] }))
      .then((body: { warnings?: string[] }) => setWarnings(body.warnings ?? []))
      .catch(() => setWarnings([]));
  }, []);

  if (warnings.length === 0) return null;
  return (
    <Alert
      type="warning"
      showIcon
      closable
      style={{ marginBottom: 16 }}
      message={t('title')}
      description={
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {warnings.map((code) => (
            <li key={code}>{isKnown(code) ? t(`codes.${MESSAGES[code]}`) : code}</li>
          ))}
        </ul>
      }
    />
  );
}
