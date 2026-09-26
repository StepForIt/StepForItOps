import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { msg } from '@nwm/core';
import { MODULE_ID_KEY } from './module-id.decorator';
import { ModuleRegistryService } from './module-registry.service';

/** Bloque (404) toutes les routes d'un module désactivé. */
@Injectable()
export class ModuleEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly registry: ModuleRegistryService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const moduleId = this.reflector.getAllAndOverride<string | undefined>(MODULE_ID_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!moduleId) return true; // route hors module désactivable
    if (await this.registry.isEnabled(moduleId)) return true;
    throw new NotFoundException(msg('ops.moduleDisabled', { id: moduleId }));
  }
}
