/**
 * Modules métier chargés dynamiquement.
 * Supprimer un dossier de module → son import échoue silencieusement (warning),
 * le reste de la plateforme continue de fonctionner.
 */
export const FEATURE_MODULES: Array<{ id: string; path: string; className: string }> = [
  { id: 'versioning', path: '../../modules/versioning/versioning.module', className: 'VersioningModule' },
  { id: 'verifier', path: '../../modules/verifier/verifier.module', className: 'VerifierModule' },
  { id: 'js-checker', path: '../../modules/js-checker/js-checker.module', className: 'JsCheckerModule' },
  {
    id: 'field-checker',
    path: '../../modules/field-checker/field-checker.module',
    className: 'FieldCheckerModule',
  },
  {
    id: 'remote-schema',
    path: '../../modules/remote-schema/remote-schema.module',
    className: 'RemoteSchemaModule',
  },
  { id: 'tester', path: '../../modules/tester/tester.module', className: 'TesterModule' },
  {
    id: 'env-switcher',
    path: '../../modules/env-switcher/env-switcher.module',
    className: 'EnvSwitcherModule',
  },
  { id: 'organizer', path: '../../modules/organizer/organizer.module', className: 'OrganizerModule' },
  { id: 'doc-schema', path: '../../modules/doc-schema/doc-schema.module', className: 'DocSchemaModule' },
  { id: 'dep-graph', path: '../../modules/dep-graph/dep-graph.module', className: 'DepGraphModule' },
  { id: 'optimizer', path: '../../modules/optimizer/optimizer.module', className: 'OptimizerModule' },
  { id: 'monitoring', path: '../../modules/monitoring/monitoring.module', className: 'MonitoringModule' },
  { id: 'performance', path: '../../modules/performance/performance.module', className: 'PerformanceModule' },
  { id: 'notifier', path: '../../modules/notifier/notifier.module', className: 'NotifierModule' },
  { id: 'dashboard', path: '../../modules/dashboard/dashboard.module', className: 'DashboardModule' },
  { id: 'ai-cost', path: '../../modules/ai-cost/ai-cost.module', className: 'AiCostModule' },
  {
    id: 'model-audit',
    path: '../../modules/model-audit/model-audit.module',
    className: 'ModelAuditModule',
  },
  {
    id: 'config-transfer',
    path: '../../modules/config-transfer/config-transfer.module',
    className: 'ConfigTransferModule',
  },
  {
    id: 'resource-discovery',
    path: '../../modules/resource-discovery/resource-discovery.module',
    className: 'ResourceDiscoveryModule',
  },
  {
    id: 'workflow-groups',
    path: '../../modules/workflow-groups/workflow-groups.module',
    className: 'WorkflowGroupsModule',
  },
  { id: 'app-logs', path: '../../modules/app-logs/app-logs.module', className: 'AppLogsModule' },
  {
    id: 'release-procedures',
    path: '../../modules/release-procedures/release-procedures.module',
    className: 'ReleaseProceduresModule',
  },
  {
    id: 'workflow-chat',
    path: '../../modules/workflow-chat/workflow-chat.module',
    className: 'WorkflowChatModule',
  },
  {
    id: 'assistant-learning',
    path: '../../modules/assistant-learning/assistant-learning.module',
    className: 'AssistantLearningModule',
  },
];
