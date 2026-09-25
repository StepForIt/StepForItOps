'use client';

import React from 'react';
import { Checkbox, Typography, theme } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useLongPress } from 'use-long-press';
import { RowEffect, rowGesture } from './mobile-gestures';

/** Au-delà, le doigt fait défiler la liste : ce n'est plus un appui long. */
const LONG_PRESS_MOVE_TOLERANCE = 10;
const LONG_PRESS_MS = 500;

/**
 * Une ligne de la liste mobile : repliée, le titre (une ligne, tronqué) et ses
 * badges ; dépliée, le détail en dessous. Le tap et l'appui long sont traduits
 * par `rowGesture` ; la ligne ne décide de rien, elle rapporte l'effet à son parent.
 */
export function MobileRow({
  title,
  badges,
  expanded,
  selecting,
  selected,
  onEffect,
  children,
}: {
  title: React.ReactNode;
  badges?: React.ReactNode;
  expanded: boolean;
  /** Mode sélection ouvert (au moins une ligne cochée sur la page). */
  selecting: boolean;
  selected: boolean;
  onEffect: (effect: RowEffect) => void;
  /** Détail, monté seulement quand la ligne est dépliée. */
  children?: React.ReactNode;
}) {
  const { token } = theme.useToken();
  // Le relâché d'un appui long émet aussi un clic : sans ce drapeau, la ligne
  // cochée à l'appui serait aussitôt décochée par le tap qui suit. Il est remis
  // à zéro à chaque nouvel appui, car certains navigateurs mobiles n'émettent
  // pas ce clic et le drapeau avalerait alors le tap suivant.
  const longPressed = React.useRef(false);
  const bind = useLongPress(
    () => {
      longPressed.current = true;
      navigator.vibrate?.(15);
      onEffect(rowGesture('long', selecting));
    },
    {
      threshold: LONG_PRESS_MS,
      cancelOnMovement: LONG_PRESS_MOVE_TOLERANCE,
      onStart: () => {
        longPressed.current = false;
      },
    },
  );

  const tap = () => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    onEffect(rowGesture('tap', selecting));
  };

  return (
    <div style={{ width: '100%' }}>
      <div
        {...bind()}
        role="button"
        tabIndex={0}
        aria-expanded={selecting ? undefined : expanded}
        aria-pressed={selecting ? selected : undefined}
        onClick={tap}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onEffect(rowGesture('tap', selecting));
        }}
        // Le menu contextuel natif (Android) et la bulle de sélection de texte
        // (iOS) prendraient l'appui long pour eux.
        onContextMenu={(event) => event.preventDefault()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 48,
          padding: '8px 12px',
          cursor: 'pointer',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitTapHighlightColor: 'transparent',
          background: selected ? token.controlItemBgActive : undefined,
        }}
      >
        {selecting && <Checkbox checked={selected} tabIndex={-1} style={{ pointerEvents: 'none' }} />}
        <Typography.Text strong ellipsis style={{ flex: 1, minWidth: 0 }}>
          {title}
        </Typography.Text>
        {badges && <div style={{ flex: 'none' }}>{badges}</div>}
        {!selecting && (
          <DownOutlined
            aria-hidden
            style={{
              flex: 'none',
              fontSize: 12,
              color: token.colorTextTertiary,
              transform: expanded ? 'rotate(180deg)' : undefined,
              transition: 'transform 0.2s',
            }}
          />
        )}
      </div>
      {expanded && <div style={{ padding: '0 12px 12px' }}>{children}</div>}
    </div>
  );
}
