import { BRAND } from '../../lib/brand/colors';

/**
 * Le motif de la marque en filigrane : les nœuds lagon reliés, et la comète ambre qui
 * court sur deux liens (animation SVG). Décoratif, masqué aux lecteurs d'écran.
 */
const NODES: [number, number][] = [
  [40, 150],
  [150, 60],
  [270, 130],
  [230, 250],
  [360, 40],
  [420, 190],
  [520, 110],
];
const LINKS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [2, 4],
  [4, 6],
  [2, 5],
  [5, 6],
];

export function NodeMotif() {
  return (
    <svg
      className="dash-motif"
      viewBox="0 0 560 280"
      preserveAspectRatio="xMaxYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {LINKS.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={NODES[a][0]}
          y1={NODES[a][1]}
          x2={NODES[b][0]}
          y2={NODES[b][1]}
          stroke="rgba(4, 178, 173, 0.28)"
          strokeWidth={2}
        />
      ))}
      {NODES.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 2 ? 9 : 6} fill={BRAND.lagon} opacity={i === 2 ? 0.8 : 0.45} />
      ))}
      <circle r={7} fill={BRAND.ambre}>
        <animateMotion dur="5s" repeatCount="indefinite" path="M150 60 L270 130 L420 190" />
        <animate
          attributeName="opacity"
          values="0;1;1;0"
          keyTimes="0;0.15;0.85;1"
          dur="5s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}
