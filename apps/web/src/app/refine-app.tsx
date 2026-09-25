'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Refine } from '@refinedev/core';
import {
  useNotificationProvider,
  ThemedLayoutV2,
  ThemedSiderV2,
  ThemedTitleV2,
  RefineThemes,
} from '@refinedev/antd';
import routerProvider from '@refinedev/nextjs-router';
import dataProvider from '@refinedev/simple-rest';
import { App as AntdApp, ConfigProvider } from 'antd';
import {
  ApartmentOutlined,
  ApiOutlined,
  AppstoreOutlined,
  BellOutlined,
  BranchesOutlined,
  BugOutlined,
  CloudUploadOutlined,
  DashboardOutlined,
  DeliveredProcedureOutlined,
  DollarOutlined,
  OrderedListOutlined,
  RobotOutlined,
  FileTextOutlined,
  ExperimentOutlined,
  BulbOutlined,
  EyeInvisibleOutlined,
  FolderOpenOutlined,
  HeartOutlined,
  QuestionCircleOutlined,
  ShareAltOutlined,
  TableOutlined,
  TeamOutlined,
  SwapOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { API_URL } from '../lib/api';
import { InstanceScopeGate, InstanceScopeProvider } from '../lib/instance-scope';
import { EnabledModulesProvider, hideDisabledResources, useEnabledModules } from '../lib/enabled-modules';
import { EnvsProvider } from '../lib/envs';
import { withMenuGroups } from '../lib/menu-groups';
import { CommandPaletteProvider } from '../components/command-palette';
import { CommandSearchMenuItem } from '../components/command-search-menu-item';
import { InstallAppButton } from '../components/install-app-button';
import { InstanceScopeMenuItem } from '../components/instance-scope-menu-item';
import { MenuNavProgress } from '../components/menu-nav-progress';
import { SecurityWarnings } from '../components/security-warnings';
import { UserMenuItem } from '../components/user-menu-item';
import { LicenseNotice } from '../components/license-notice';
import { MobileTopBar } from '../components/mobile-top-bar';
import { WorkflowChatProvider } from '../components/workflow-chat-drawer';
import { ReleaseRecorderProvider } from '../components/release-recorder/release-recorder';
import { WorkflowLocksProvider } from '../lib/workflow-lock/workflow-locks';
import '@refinedev/antd/dist/reset.css';

export function RefineApp({ children }: { children: React.ReactNode }) {
  // Login et premier setup s'affichent hors console : ni menu, ni providers
  // Refine (qui interrogeraient l'API alors que la session n'existe pas encore).
  if (['/login', '/setup'].includes(usePathname())) {
    return (
      <ConfigProvider theme={RefineThemes.Blue}>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={RefineThemes.Blue}>
      <AntdApp>
        <EnabledModulesProvider>
          <EnvsProvider>
            <Console>{children}</Console>
          </EnvsProvider>
        </EnabledModulesProvider>
      </AntdApp>
    </ConfigProvider>
  );
}

// L'ordre du tableau est celui du menu : un groupe s'affiche à la position de son
// premier enfant, donc les enfants d'un même groupe restent contigus.
const RESOURCES = [
  {
    name: 'workflows',
    list: '/workflows',
    show: '/workflows/show/:id',
    meta: { label: 'Workflows', icon: <ApartmentOutlined /> },
  },
  // Vue groupée de la même liste (workflows d'un même métier, un par env) : pas d'entrée de menu.
  { name: 'workflows/families', meta: { hide: true } },
  {
    name: 'versions',
    list: '/versions',
    meta: { label: 'Versions', icon: <BranchesOutlined /> },
  },
  {
    name: 'workflow-map',
    list: '/workflow-map',
    meta: { label: 'Carte workflows', icon: <ShareAltOutlined /> },
  },
  {
    name: 'findings',
    list: '/findings',
    meta: { label: 'Findings', icon: <BugOutlined />, parent: 'quality' },
  },
  {
    name: 'test-runs',
    list: '/test-runs',
    meta: { label: 'Tests', icon: <ExperimentOutlined />, parent: 'quality' },
  },
  {
    name: 'monitors',
    list: '/monitors',
    create: '/monitors/create',
    edit: '/monitors/edit/:id',
    meta: {
      label: 'Monitoring',
      icon: <HeartOutlined />,
      parent: 'health',
      createLabel: 'Nouveau monitor',
    },
  },
  {
    name: 'execution-errors',
    list: '/errors',
    meta: { label: 'Erreurs', icon: <WarningOutlined />, parent: 'health' },
  },
  {
    name: 'performance',
    list: '/performance',
    meta: { label: 'Performance', icon: <DashboardOutlined />, parent: 'health' },
  },
  {
    name: 'ai-cost',
    list: '/llm-costs',
    meta: { label: 'Coûts IA', icon: <DollarOutlined />, parent: 'health' },
  },
  {
    name: 'model-audit',
    list: '/model-audit',
    meta: { label: 'Modèles IA', icon: <RobotOutlined />, parent: 'health' },
  },
  // Même page que « Erreurs » (onglet Problèmes) : pas d'entrée de menu.
  { name: 'error-groups', meta: { hide: true } },
  {
    name: 'resource-mappings',
    list: '/resource-mappings',
    create: '/resource-mappings/create',
    edit: '/resource-mappings/edit/:id',
    meta: {
      label: 'Mappings env',
      icon: <SwapOutlined />,
      parent: 'environments',
      createLabel: 'Nouveau mapping env',
    },
  },
  {
    name: 'release-procedures',
    list: '/procedures',
    meta: { label: 'Procédures', icon: <OrderedListOutlined />, parent: 'environments' },
  },
  {
    name: 'resources',
    list: '/resources',
    meta: { label: 'Ressources externes', icon: <TableOutlined />, parent: 'environments' },
  },
  {
    name: 'instances',
    list: '/instances',
    create: '/instances/create',
    edit: '/instances/edit/:id',
    show: '/instances/show/:id',
    meta: {
      label: 'Instances',
      icon: <ApiOutlined />,
      parent: 'settings',
      createLabel: 'Nouvelle instance n8n',
    },
  },
  {
    name: 'clients',
    list: '/clients',
    meta: { label: 'Clients', icon: <TeamOutlined />, parent: 'settings' },
  },
  {
    name: 'workflow-groups',
    list: '/workflow-groups',
    create: '/workflow-groups/create',
    edit: '/workflow-groups/edit/:id',
    meta: {
      label: 'Groupes',
      icon: <FolderOpenOutlined />,
      parent: 'settings',
      createLabel: 'Nouveau groupe de workflows',
    },
  },
  {
    name: 'finding-ignores',
    list: '/finding-ignores',
    meta: { label: 'Findings ignorés', icon: <EyeInvisibleOutlined />, parent: 'settings' },
  },
  {
    name: 'assistant-lessons',
    list: '/assistant-lessons',
    meta: { label: 'Leçons IA', icon: <BulbOutlined />, parent: 'settings' },
  },
  {
    name: 'notification-channels',
    list: '/notification-channels',
    meta: { label: 'Alertes', icon: <BellOutlined />, parent: 'settings' },
  },
  {
    name: 'export-targets',
    list: '/export-targets',
    create: '/export-targets/create',
    edit: '/export-targets/edit/:id',
    meta: {
      label: 'Cibles export',
      icon: <CloudUploadOutlined />,
      parent: 'settings',
      createLabel: "Nouvelle cible d'export",
    },
  },
  {
    name: 'modules',
    list: '/modules',
    meta: { label: 'Modules', icon: <AppstoreOutlined />, parent: 'settings' },
  },
  {
    name: 'app-logs',
    list: '/app-logs',
    meta: { label: 'Logs', icon: <FileTextOutlined />, parent: 'settings' },
  },
  {
    name: 'config-transfer',
    list: '/config-transfer',
    meta: { label: 'Export / Import', icon: <DeliveredProcedureOutlined />, parent: 'settings' },
  },
  {
    name: 'aide',
    list: '/aide',
    meta: { label: 'Aide', icon: <QuestionCircleOutlined />, bottom: true },
  },
];

/**
 * react-query arbitre par défaut sur `navigator.onLine` : navigateur déclaré hors-ligne, il
 * MET LA REQUÊTE EN PAUSE au lieu de l'envoyer — aucun appel, aucune erreur, aucun log, et la
 * table reste sur son voile de chargement indéfiniment. Ce verdict ne vaut rien ici : toutes
 * les données viennent du proxy Next, sur l'origine même de la page. On lui retire donc
 * l'arbitrage — une requête part, et c'est son échec qui dira que le réseau manque.
 */
const REACT_QUERY = {
  clientConfig: {
    defaultOptions: {
      queries: { networkMode: 'always' as const },
      mutations: { networkMode: 'always' as const },
    },
  },
};

/** La console : menu + providers Refine, une fois la session établie. */
function Console({ children }: { children: React.ReactNode }) {
  const { enabled } = useEnabledModules();

  return (
    <Refine
      routerProvider={routerProvider}
      dataProvider={dataProvider(API_URL)}
      notificationProvider={useNotificationProvider}
      resources={withMenuGroups(hideDisabledResources(RESOURCES, enabled))}
      options={{ syncWithLocation: true, warnWhenUnsavedChanges: true, reactQuery: REACT_QUERY }}
    >
      <InstanceScopeProvider>
        <MenuNavProgress>
          <CommandPaletteProvider>
            <ThemedLayoutV2
              Header={MobileTopBar}
              Sider={() => (
                // `display: contents` : l'enveloppe ne compte pas dans la mise en page,
                // elle ne sert qu'à masquer le bouton de menu mobile du sider (cf. MobileTopBar).
                <div className="app-sider">
                  <ThemedSiderV2
                    Title={({ collapsed }) => <ThemedTitleV2 collapsed={collapsed} text="StepForIt Ops" />}
                    render={({ items, logout, collapsed }) => (
                      <>
                        <CommandSearchMenuItem collapsed={collapsed} />
                        <InstanceScopeMenuItem collapsed={collapsed} />
                        {items}
                        {logout}
                        <InstallAppButton collapsed={collapsed} />
                        <UserMenuItem collapsed={collapsed} />
                        <LicenseNotice collapsed={collapsed} />
                      </>
                    )}
                  />
                </div>
              )}
            >
              <SecurityWarnings />
              <WorkflowLocksProvider>
                <WorkflowChatProvider>
                  <ReleaseRecorderProvider>
                    <InstanceScopeGate>{children}</InstanceScopeGate>
                  </ReleaseRecorderProvider>
                </WorkflowChatProvider>
              </WorkflowLocksProvider>
            </ThemedLayoutV2>
          </CommandPaletteProvider>
        </MenuNavProgress>
      </InstanceScopeProvider>
    </Refine>
  );
}
