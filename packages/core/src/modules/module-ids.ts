/** Ids des modules connus (les modules eux-mêmes restent supprimables). */
export const MODULE_IDS = {
  instances: 'instances',
  workflows: 'workflows',
  moduleAdmin: 'module-admin',
  versioning: 'versioning',
  verifier: 'verifier',
  jsChecker: 'js-checker',
  fieldChecker: 'field-checker',
  tester: 'tester',
  envSwitcher: 'env-switcher',
  organizer: 'organizer',
  docSchema: 'doc-schema',
  depGraph: 'dep-graph',
  optimizer: 'optimizer',
  monitoring: 'monitoring',
} as const;

export type ModuleId = (typeof MODULE_IDS)[keyof typeof MODULE_IDS];
