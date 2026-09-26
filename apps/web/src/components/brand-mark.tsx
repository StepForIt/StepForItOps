'use client';

import { useId } from 'react';
import { BRAND } from '../lib/brand/colors';

/**
 * Le signe StepForIt Ops : deux groupes de nœuds, le « / » du studio en creux, une
 * comète ambre qui le parcourt. Même géométrie que les SVG de référence
 * (StepForIt/video-studio, `brand/`) ; sous 48 px il passe en version épurée,
 * un lien par groupe et des nœuds plus gros, seule lisible à la taille d'un menu.
 */
export function BrandMark({ size = 28, onDark = false }: { size?: number; onDark?: boolean }) {
  const trail = useId();
  const small = size < 48;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={trail} x1="43" y1="62.5" x2="58" y2="37" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={BRAND.ambre} stopOpacity="0" />
          <stop offset="1" stopColor={BRAND.ambre} stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect
        x="1.5"
        y="1.5"
        width="97"
        height="97"
        rx="23"
        fill={BRAND.nuit}
        stroke={small || onDark ? 'rgba(4,178,173,0.55)' : 'none'}
        strokeWidth="3"
      />
      <g stroke="rgba(4,178,173,0.45)" strokeWidth={small ? 6 : 3.5} strokeLinecap="round">
        <line x1="36" y1="74" x2="20" y2="34" />
        <line x1="64" y1="26" x2="80" y2="66" />
        {!small && <line x1="20" y1="34" x2="40" y2="22" />}
        {!small && <line x1="80" y1="66" x2="60" y2="78" />}
      </g>
      <circle cx="20" cy="34" r={small ? 7 : 5} fill={BRAND.lagon} opacity="0.8" />
      <circle cx="80" cy="66" r={small ? 7 : 5} fill={BRAND.lagon} opacity="0.8" />
      {!small && <circle cx="40" cy="22" r="4.5" fill={BRAND.lagon} opacity="0.6" />}
      {!small && <circle cx="60" cy="78" r="4.5" fill={BRAND.lagon} opacity="0.6" />}
      <circle cx="36" cy="74" r={small ? 10 : 8} fill={BRAND.lagon} />
      <circle cx="64" cy="26" r={small ? 10 : 8} fill={BRAND.lagon} />
      <line
        x1="43"
        y1="62.5"
        x2="58"
        y2="37"
        stroke={`url(#${trail})`}
        strokeWidth={small ? 9 : 7}
        strokeLinecap="round"
      />
      <circle cx="58" cy="37" r={small ? 8.5 : 6.6} fill={BRAND.ambre} />
    </svg>
  );
}

/** Le nom : « Ops » en lagon, dans la police des titres. */
export function BrandWordmark({ size = 17, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-display), system-ui, sans-serif',
        fontWeight: 700,
        fontSize: size,
        letterSpacing: -0.2,
        color: onDark ? '#FFFFFF' : BRAND.nuit,
      }}
    >
      StepForIt <span style={{ color: onDark ? BRAND.lagon : BRAND.primary }}>Ops</span>
    </span>
  );
}
