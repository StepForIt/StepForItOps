'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Refine } from '@refinedev/core';
import { useNotificationProvider, ThemedLayoutV2, ThemedSiderV2, ThemedTitleV2 } from '@refinedev/antd';
import routerProvider from '@refinedev/nextjs-router';
import dataProvider from '@refinedev/simple-rest';
import { App as AntdApp, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import frFR from 'antd/locale/fr_FR';
import { useLocale, useTranslations } from 'next-intl';
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
import { LanguageMenuItem } from '../components/language-menu-item';
import { useI18nProvider } from '../i18n/refine-i18n-provider';
import { BrandMark, BrandWordmark } from '../components/brand-mark';
import { CONSOLE_THEME, SIDER_THEME } from '../lib/brand/theme';
import '@refinedev/antd/dist/reset.css';

export function RefineApp({ children }: { children: React.ReactNode }) {
  const antdLocale = useLocale() === 'en' ? enUS : frFR;
  // Login et premier setup s'affichent hors console : ni menu, ni providers
  // Refine (qui interrogeraient l'API alors que la session n'existe pas encore).
  if (['/login', '/setup'].includes(usePathname())) {
    return (
      <ConfigProvider theme={CONSOLE_THEME} locale={antdLocale}>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider theme={CONSOLE_THEME} locale={antdLocale}>
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
const buildResources = (t: ReturnType<typeof useTranslations<'app.menu'>>) => [
  {
    name: 'workflows',
    list: '/workflows',
    show: '/workflows/show/:id',
    meta: { label: t('workflows'), icon: <ApartmentOutlined /> },
  },
  // Vue groupée de la même liste (workflows d'un même métier, un par env) : pas d'entrée de menu.
  { name: 'workflows/families', meta: { hide: true } },
  {
    name: 'versions',
    list: '/versions',
    meta: { label: t('versions'), icon: <BranchesOutlined /> },
  },
  {
    name: 'workflow-map',
    list: '/workflow-map',
    meta: { label: t('workflowMap'), icon: <ShareAltOutlined /> },
  },
  {
    name: 'findings',
    list: '/findings',
    meta: { label: t('findings'), icon: <BugOutlined />, parent: 'quality' },
  },
  {
    name: 'test-runs',
    list: '/test-runs',
    meta: { label: t('testRuns'), icon: <ExperimentOutlined />, parent: 'quality' },
  },
  {
    name: 'monitors',
    list: '/monitors',
    create: '/monitors/create',
    edit: '/monitors/edit/:id',
    meta: {
      label: t('monitors'),
      icon: <HeartOutlined />,
      parent: 'health',
      createLabel: t('monitorsCreate'),
    },
  },
  {
    name: 'execution-errors',
    list: '/errors',
    meta: { label: t('errors'), icon: <WarningOutlined />, parent: 'health' },
  },
  {
    name: 'performance',
    list: '/performance',
    meta: { label: t('performance'), icon: <DashboardOutlined />, parent: 'health' },
  },
  {
    name: 'ai-cost',
    list: '/llm-costs',
    meta: { label: t('aiCost'), icon: <DollarOutlined />, parent: 'health' },
  },
  {
    name: 'model-audit',
    list: '/model-audit',
    meta: { label: t('modelAudit'), icon: <RobotOutlined />, parent: 'health' },
  },
  // Même page que « Erreurs » (onglet Problèmes) : pas d'entrée de menu.
  { name: 'error-groups', meta: { hide: true } },
  {
    name: 'resource-mappings',
    list: '/resource-mappings',
    create: '/resource-mappings/create',
    edit: '/resource-mappings/edit/:id',
    meta: {
      label: t('resourceMappings'),
      icon: <SwapOutlined />,
      parent: 'environments',
      createLabel: t('resourceMappingsCreate'),
    },
  },
  {
    name: 'release-procedures',
    list: '/procedures',
    meta: { label: t('procedures'), icon: <OrderedListOutlined />, parent: 'environments' },
  },
  {
    name: 'resources',
    list: '/resources',
    meta: { label: t('resources'), icon: <TableOutlined />, parent: 'environments' },
  },
  {
    name: 'instances',
    list: '/instances',
    create: '/instances/create',
    edit: '/instances/edit/:id',
    show: '/instances/show/:id',
    meta: {
      label: t('instances'),
      icon: <ApiOutlined />,
      parent: 'settings',
      createLabel: t('instancesCreate'),
    },
  },
  {
    name: 'clients',
    list: '/clients',
    meta: { label: t('clients'), icon: <TeamOutlined />, parent: 'settings' },
  },
  {
    name: 'workflow-groups',
    list: '/workflow-groups',
    create: '/workflow-groups/create',
    edit: '/workflow-groups/edit/:id',
    meta: {
      label: t('workflowGroups'),
      icon: <FolderOpenOutlined />,
      parent: 'settings',
      createLabel: t('workflowGroupsCreate'),
    },
  },
  {
    name: 'finding-ignores',
    list: '/finding-ignores',
    meta: { label: t('findingIgnores'), icon: <EyeInvisibleOutlined />, parent: 'settings' },
  },
  {
    name: 'assistant-lessons',
    list: '/assistant-lessons',
    meta: { label: t('assistantLessons'), icon: <BulbOutlined />, parent: 'settings' },
  },
  {
    name: 'notification-channels',
    list: '/notification-channels',
    meta: { label: t('notificationChannels'), icon: <BellOutlined />, parent: 'settings' },
  },
  {
    name: 'export-targets',
    list: '/export-targets',
    create: '/export-targets/create',
    edit: '/export-targets/edit/:id',
    meta: {
      label: t('exportTargets'),
      icon: <CloudUploadOutlined />,
      parent: 'settings',
      createLabel: t('exportTargetsCreate'),
    },
  },
  {
    name: 'modules',
    list: '/modules',
    meta: { label: t('modules'), icon: <AppstoreOutlined />, parent: 'settings' },
  },
  {
    name: 'app-logs',
    list: '/app-logs',
    meta: { label: t('appLogs'), icon: <FileTextOutlined />, parent: 'settings' },
  },
  {
    name: 'config-transfer',
    list: '/config-transfer',
    meta: { label: t('configTransfer'), icon: <DeliveredProcedureOutlined />, parent: 'settings' },
  },
  {
    name: 'aide',
    list: '/aide',
    meta: { label: t('help'), icon: <QuestionCircleOutlined />, bottom: true },
  },
];

const MENU_GROUP_KEYS = {
  quality: 'quality',
  health: 'health',
  environments: 'environments',
  settings: 'settings',
} as const;

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
  const tMenu = useTranslations('app.menu');
  const tGroups = useTranslations('app.menuGroups');
  const i18nProvider = useI18nProvider();
  const resources = React.useMemo(
    () =>
      withMenuGroups(hideDisabledResources(buildResources(tMenu), enabled), (id) =>
        id in MENU_GROUP_KEYS ? tGroups(MENU_GROUP_KEYS[id as keyof typeof MENU_GROUP_KEYS]) : id,
      ),
    [tMenu, tGroups, enabled],
  );

  return (
    <Refine
      routerProvider={routerProvider}
      dataProvider={dataProvider(API_URL)}
      notificationProvider={useNotificationProvider}
      i18nProvider={i18nProvider}
      resources={resources}
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
                  <ConfigProvider theme={SIDER_THEME}>
                    <ThemedSiderV2
                      Title={({ collapsed }) => (
                        <ThemedTitleV2
                          collapsed={collapsed}
                          icon={<BrandMark size={26} onDark />}
                          text={<BrandWordmark onDark />}
                        />
                      )}
                      render={({ items, logout, collapsed }) => (
                        <>
                          <CommandSearchMenuItem collapsed={collapsed} />
                          <InstanceScopeMenuItem collapsed={collapsed} />
                          {items}
                          {logout}
                          <InstallAppButton collapsed={collapsed} />
                          <LanguageMenuItem collapsed={collapsed} />
                          <UserMenuItem collapsed={collapsed} />
                          <LicenseNotice collapsed={collapsed} />
                        </>
                      )}
                    />
                  </ConfigProvider>
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
