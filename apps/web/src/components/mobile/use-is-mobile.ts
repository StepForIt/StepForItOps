'use client';

import { Grid } from 'antd';

/**
 * Sous le breakpoint `md` (768 px) : téléphone, ou tablette tenue en portrait.
 * `undefined` au premier rendu (breakpoints pas encore mesurés) compte comme
 * desktop — le rendu par défaut de la console.
 */
export function useIsMobile(): boolean {
  return Grid.useBreakpoint().md === false;
}
