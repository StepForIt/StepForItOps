'use client';

import React, { useEffect, useState } from 'react';
import { Alert } from 'antd';

/**
 * Bannière d'avertissement quand la plateforme tourne sans protection :
 * pas d'authentification front, API sans jeton, ou secret de session absent.
 * Volontairement bruyante — une install de prod correctement configurée ne la
 * voit jamais, et en dev local elle rappelle que tout est ouvert.
 */

const MESSAGES: Record<string, string> = {
  'auth-open': "Accès sans authentification — créer l'admin via /setup.",
  'api-open': 'API_ACCESS_TOKEN absent : API anonyme.',
  'no-session-secret': 'SESSION_SECRET absent.',
};

export function SecurityWarnings() {
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
      message="Configuration de sécurité incomplète"
      description={
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {warnings.map((code) => (
            <li key={code}>{MESSAGES[code] ?? code}</li>
          ))}
        </ul>
      }
    />
  );
}
