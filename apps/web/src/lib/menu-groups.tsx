'use client';

import React from 'react';
import {
  DeploymentUnitOutlined,
  LineChartOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from '@ant-design/icons';

/**
 * Regroupements du menu. Une resource demande son groupe elle-même (`meta.parent`) :
 * le groupe n'existe que si au moins une resource visible le réclame.
 */
export const MENU_GROUPS: Record<string, { label: string; icon: React.ReactNode }> = {
  quality: { label: 'Qualité', icon: <SafetyCertificateOutlined /> },
  health: { label: 'Santé', icon: <LineChartOutlined /> },
  environments: { label: 'Environnements', icon: <DeploymentUnitOutlined /> },
  settings: { label: 'Paramètres', icon: <SettingOutlined /> },
};

interface MenuResource {
  name: string;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Crée les resources « groupe » réclamées par `meta.parent` et absentes de la liste.
 * Les resources groupées passent en fin de liste : Refine place un groupe à la position
 * de son premier enfant, les groupes restent donc sous les entrées de premier niveau.
 * `meta.bottom` place une entrée sous les groupes (Aide).
 */
export function withMenuGroups<T extends MenuResource>(resources: T[]): (T | MenuResource)[] {
  const known = new Set(resources.map((resource) => resource.name));
  const topLevel: T[] = [];
  const grouped: T[] = [];
  const bottom: T[] = [];
  const groups: MenuResource[] = [];

  for (const resource of resources) {
    if (resource.meta?.bottom) {
      bottom.push(resource);
      continue;
    }
    const parent = resource.meta?.parent;
    if (typeof parent !== 'string') {
      topLevel.push(resource);
      continue;
    }
    grouped.push(resource);
    if (known.has(parent)) continue;
    // Un enfant masqué (module désactivé) ne justifie pas d'afficher le groupe.
    if (resource.meta?.hide) continue;
    known.add(parent);
    const group = MENU_GROUPS[parent];
    groups.push({ name: parent, meta: { label: group?.label ?? parent, icon: group?.icon } });
  }

  return [...topLevel, ...grouped, ...groups, ...bottom];
}
