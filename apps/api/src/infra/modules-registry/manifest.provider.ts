import { Provider } from '@nestjs/common';
import { ModuleManifest } from '@nwm/core';
import { ModuleRegistryService } from './module-registry.service';

/** Provider standard qui enregistre le manifest d'un module auprès du registre. */
export function manifestProvider(manifest: ModuleManifest): Provider {
  return {
    provide: `MANIFEST_${manifest.id}`,
    useFactory: (registry: ModuleRegistryService): ModuleManifest => {
      registry.register(manifest);
      return manifest;
    },
    inject: [ModuleRegistryService],
  };
}
