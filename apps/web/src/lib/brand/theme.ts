import { theme, type ThemeConfig } from 'antd';
import { BRAND, PRESET_DOTS } from './colors';

/**
 * Le thème de la console, à la place de `RefineThemes.Blue` : la primaire devient
 * le lagon de la charte, les statuts ses teintes (au contraste du texte), et les
 * polices celles de la marque — Inter pour l'interface, Familjen Grotesk pour les
 * titres (posée dans `globals.css`).
 *
 * Tags et bandeaux ne gardent pas l'habillage antd (aplats pastel, jaune pâle) :
 * `design-system.css` les rend en pastille neutre à point de couleur et en encart à
 * filet. Les fonds « soft » d'antd sont donc ramenés au papier ici, pour que ce qui
 * échappe au CSS (badges, résultats, notifications) reste dans la même famille.
 */
export const CONSOLE_THEME: ThemeConfig = {
  token: {
    colorPrimary: BRAND.primary,
    colorInfo: BRAND.primary,
    colorLink: BRAND.primary,
    // Aplats, icônes, bordures et points : les couleurs de la charte telles quelles.
    colorSuccess: BRAND.roi,
    colorWarning: BRAND.ambre,
    colorError: BRAND.corail,
    // Le petit texte de statut, lui, prend leur version foncée (≥ 4,5:1 sur blanc).
    colorSuccessText: BRAND.success,
    colorWarningText: BRAND.warning,
    colorErrorText: BRAND.danger,
    colorTextBase: BRAND.nuit,
    colorBorderSecondary: BRAND.hairline,
    colorBgLayout: BRAND.papier,
    colorSuccessBg: BRAND.papier,
    colorWarningBg: BRAND.papier,
    colorErrorBg: BRAND.papier,
    colorInfoBg: BRAND.papier,
    fontFamily: 'var(--font-text), Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    borderRadius: 8,
  },
};

/**
 * Le menu latéral, en aplat nuit : l'algorithme sombre d'antd sur ce seul sous-arbre,
 * pour que tout ce qu'il contient (recherche, sélecteur d'instance, boutons, tiroir
 * mobile, listes déroulantes) prenne des couleurs faites pour ce fond — là où des
 * surcharges CSS laissaient la moitié des contrôles en texte nuit sur fond nuit.
 */
export const SIDER_THEME: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    ...CONSOLE_THEME.token,
    colorPrimary: BRAND.lagon,
    colorInfo: BRAND.lagon,
    colorLink: BRAND.lagon,
    colorTextBase: BRAND.craie,
    colorBgBase: BRAND.nuit,
    colorBgContainer: BRAND.nuit,
    colorBgLayout: BRAND.nuit,
    colorBgElevated: '#0B2440',
    colorBorder: 'rgba(232, 238, 242, 0.16)',
    colorBorderSecondary: 'rgba(232, 238, 242, 0.08)',
    colorSuccessBg: undefined,
    colorWarningBg: undefined,
    colorErrorBg: undefined,
    colorInfoBg: undefined,
  },
  components: {
    Layout: { siderBg: BRAND.nuit, triggerBg: BRAND.nuit, triggerColor: 'rgba(232, 238, 242, 0.6)' },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemColor: 'rgba(232, 238, 242, 0.74)',
      itemHoverColor: '#FFFFFF',
      itemHoverBg: 'rgba(255, 255, 255, 0.06)',
      itemSelectedBg: 'rgba(4, 178, 173, 0.16)',
      itemSelectedColor: '#FFFFFF',
    },
  },
};

/** Les points de couleur des tags, en variables CSS (lues par `design-system.css`). */
export const BRAND_CSS_VARS = `:root{${Object.entries(PRESET_DOTS)
  .map(([name, hex]) => `--dot-${name}:${hex};`)
  .join(
    '',
  )}--brand-papier:${BRAND.papier};--brand-hairline:${BRAND.hairline};--brand-nuit:${BRAND.nuit};--brand-primary:${BRAND.primary};--brand-ambre:${BRAND.ambre};--brand-success:${BRAND.roi};--brand-danger:${BRAND.corail};--brand-lagon:${BRAND.lagon};}`;
