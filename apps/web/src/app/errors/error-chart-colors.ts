/** Palette partagée par la courbe et la heatmap : même workflow = même couleur partout. */
import { BRAND, CHART_SERIES, HEAT_SCALE } from '../../lib/brand/colors';
export const WORKFLOW_COLORS: readonly string[] = CHART_SERIES;

export const OTHERS_COLOR = BRAND.hairline;
export const OTHERS_KEY = '__others__';

/** Les N workflows les plus cassants reçoivent une couleur, le reste tombe dans « autres ». */
export function buildColorMap(keys: string[], max = WORKFLOW_COLORS.length): Map<string, string> {
  const colors = new Map<string, string>();
  keys.slice(0, max).forEach((key, index) => colors.set(key, WORKFLOW_COLORS[index]));
  return colors;
}

/** Échelle corail de la heatmap : plus c'est foncé, plus il y a eu d'erreurs ce jour-là. */
export function heatColor(count: number, max: number): string {
  if (count === 0) return BRAND.papier;
  const steps = HEAT_SCALE;
  const ratio = max <= 1 ? 1 : count / max;
  const index = Math.ceil(ratio * steps.length) - 1;
  return steps[Math.min(steps.length - 1, Math.max(0, index))];
}
