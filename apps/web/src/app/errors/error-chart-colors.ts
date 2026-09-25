/** Palette partagée par la courbe et la heatmap : même workflow = même couleur partout. */
export const WORKFLOW_COLORS = [
  '#1677ff',
  '#fa541c',
  '#52c41a',
  '#722ed1',
  '#faad14',
  '#13c2c2',
  '#eb2f96',
  '#2f54eb',
  '#a0d911',
  '#fa8c16',
];

export const OTHERS_COLOR = '#bfbfbf';
export const OTHERS_KEY = '__others__';

/** Les N workflows les plus cassants reçoivent une couleur, le reste tombe dans « autres ». */
export function buildColorMap(keys: string[], max = WORKFLOW_COLORS.length): Map<string, string> {
  const colors = new Map<string, string>();
  keys.slice(0, max).forEach((key, index) => colors.set(key, WORKFLOW_COLORS[index]));
  return colors;
}

/** Échelle de rouge de la heatmap : plus c'est foncé, plus il y a eu d'erreurs ce jour-là. */
export function heatColor(count: number, max: number): string {
  if (count === 0) return '#f5f5f5';
  const steps = ['#ffccc7', '#ffa39e', '#ff7875', '#f5222d', '#a8071a'];
  const ratio = max <= 1 ? 1 : count / max;
  const index = Math.ceil(ratio * steps.length) - 1;
  return steps[Math.min(steps.length - 1, Math.max(0, index))];
}
