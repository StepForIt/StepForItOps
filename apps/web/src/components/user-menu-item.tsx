'use client';

import React from 'react';
import { Button, Tooltip, Typography, theme } from 'antd';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';

const { Text } = Typography;

interface SessionInfo {
  authEnabled: boolean;
  user: { email: string; name: string; via: 'google' | 'password' } | null;
}

/**
 * Dernier élément du menu latéral : identité connectée + déconnexion.
 * Masqué quand aucune authentification n'est configurée (dev local ouvert).
 */
export function UserMenuItem({ collapsed }: { collapsed: boolean }) {
  const { token } = theme.useToken();
  const t = useTranslations('app.user');
  const [session, setSession] = React.useState<SessionInfo | null>(null);

  React.useEffect(() => {
    fetch('/auth/me')
      .then((response) => (response.ok ? (response.json() as Promise<SessionInfo>) : null))
      .then(setSession)
      .catch(() => setSession(null));
  }, []);

  const logout = React.useCallback(() => {
    void fetch('/auth/logout', { method: 'POST' }).finally(() => {
      window.location.href = '/login';
    });
  }, []);

  if (!session?.authEnabled || !session.user) return null;

  if (collapsed) {
    return (
      <Tooltip placement="right" title={t('logoutTooltip', { email: session.user.email })}>
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <Button type="text" size="small" icon={<LogoutOutlined />} onClick={logout} />
        </div>
      </Tooltip>
    );
  }

  return (
    <div style={{ padding: '12px 12px 16px', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
      <Text
        ellipsis={{ tooltip: session.user.email }}
        style={{ display: 'block', fontSize: 12, color: token.colorTextSecondary }}
      >
        <UserOutlined style={{ marginRight: 6 }} />
        {session.user.email}
      </Text>
      <Button type="text" size="small" icon={<LogoutOutlined />} onClick={logout} style={{ paddingLeft: 0 }}>
        {t('logout')}
      </Button>
    </div>
  );
}
