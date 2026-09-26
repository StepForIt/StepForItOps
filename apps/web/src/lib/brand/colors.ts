/**
 * Les couleurs de la charte StepForIt Ops (actée le 2026-09-26), la seule source
 * pour la console : le thème Ant Design en dérive, et un composant qui a besoin
 * d'une couleur hors du thème (graphique SVG, schéma Mermaid) la lit ici plutôt
 * que d'écrire un hexadécimal. Référence : dépôt StepForIt/video-studio, `brand/`.
 *
 * Le lagon de la marque (#04B2AD) ne tient que 2,6:1 sur blanc : il sert aux aplats
 * et aux grands titres. Tout ce qui est TEXTE ou BOUTON sur fond clair prend le
 * lagon 700 (#047A76, 5,2:1), d'où `primary`. Même règle pour les statuts : chacun
 * tient 4,5:1 sur blanc, parce qu'antd les emploie aussi comme couleur de texte.
 */
export const BRAND = {
  primary: '#047A76',
  primarySoft: '#E6F6F5',
  lagon: '#04B2AD',
  ambre: '#F5B301',
  nuit: '#06182D',
  marine: '#00458C',
  corail: '#FF5D5D',
  roi: '#2FD88A',
  // Statuts (texte sur blanc ≥ 4,5:1)
  success: '#12865A',
  warning: '#9A6200',
  danger: '#C8363B',
  // Neutres de la charte
  slate: '#52606D',
  slateLight: '#8FA3B8',
  hairline: '#DDE4EA',
  papier: '#F4F6F8',
  craie: '#E8EEF2',
} as const;

/**
 * Les couleurs « nommées » d'antd (`<Tag color="green">`, couleur d'un env…),
 * ramenées aux six couleurs de la charte, sans teinte inventée. C'est ce point qui porte le sens, la pastille restant neutre.
 */
export const PRESET_DOTS: Record<string, string> = {
  green: BRAND.roi,
  lime: BRAND.roi,
  success: BRAND.roi,
  cyan: BRAND.lagon,
  processing: BRAND.lagon,
  blue: BRAND.marine,
  geekblue: BRAND.marine,
  purple: BRAND.marine,
  magenta: BRAND.marine,
  pink: BRAND.corail,
  gold: BRAND.ambre,
  yellow: BRAND.ambre,
  orange: BRAND.ambre,
  warning: BRAND.ambre,
  volcano: BRAND.corail,
  red: BRAND.corail,
  error: BRAND.corail,
  default: BRAND.slate,
};

/**
 * Séries d'un graphique (un workflow = une couleur) : dix teintes distinctes, toutes
 * tirées de la charte, dans l'ordre où elles se distinguent le mieux deux à deux.
 */
export const CHART_SERIES = [
  BRAND.primary,
  BRAND.corail,
  BRAND.marine,
  BRAND.ambre,
  BRAND.roi,
  BRAND.lagon,
  BRAND.nuit,
  BRAND.slateLight,
  '#7FD6D2', // lagon clair
  '#F28C6B', // corail brûlé
] as const;

/** Échelle de chaleur (erreurs par jour) : du papier au corail foncé. */
export const HEAT_SCALE = ['#FFDADA', '#FFB3B3', '#FF8787', BRAND.corail, BRAND.danger] as const;
