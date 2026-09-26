import { Logger, Type } from '@nestjs/common';
import { FEATURE_MODULES } from './modules.config';

const logger = new Logger('ModulesLoader');

/**
 * Import dynamique + try/catch de chaque module métier :
 * un module supprimé du code ne casse ni le build ni le boot.
 */
export async function loadFeatureModules(): Promise<Type[]> {
  const loaded: Type[] = [];
  for (const entry of FEATURE_MODULES) {
    try {
      const imported: Record<string, Type> = await import(entry.path);
      const moduleClass = imported[entry.className];
      if (!moduleClass) throw new Error(`class ${entry.className} missing`);
      loaded.push(moduleClass);
      logger.log(`Module loaded: ${entry.id}`);
    } catch (error) {
      logger.warn(`Module "${entry.id}" not loaded (${(error as Error).message}) — skipped`);
    }
  }
  return loaded;
}
