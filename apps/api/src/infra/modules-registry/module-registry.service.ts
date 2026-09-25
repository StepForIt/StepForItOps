import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EVENTS, ModuleManifest } from '@nwm/core';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';

/** Registre central : manifests déclarés + état d'activation (DB + cache mémoire). */
@Injectable()
export class ModuleRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ModuleRegistryService.name);
  private readonly manifests = new Map<string, ModuleManifest>();
  private readonly enabledCache = new Map<string, boolean>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  register(manifest: ModuleManifest): void {
    this.manifests.set(manifest.id, manifest);
  }

  listManifests(): ModuleManifest[] {
    return [...this.manifests.values()];
  }

  async onModuleInit(): Promise<void> {
    const states = await this.prisma.moduleState.findMany();
    for (const state of states) this.enabledCache.set(state.id, state.enabled);
  }

  async isEnabled(moduleId: string): Promise<boolean> {
    const manifest = this.manifests.get(moduleId);
    if (manifest?.core) return true;
    if (this.enabledCache.has(moduleId)) return this.enabledCache.get(moduleId)!;
    const state = await this.prisma.moduleState.findUnique({ where: { id: moduleId } });
    const enabled = state?.enabled ?? true; // activé par défaut
    this.enabledCache.set(moduleId, enabled);
    return enabled;
  }

  async setEnabled(moduleId: string, enabled: boolean): Promise<void> {
    const manifest = this.manifests.get(moduleId);
    // Refus, et non panne : un `Error` nu ressortait en 500, donc journalisé
    // comme une faute du serveur alors que c'est la demande qui n'a pas de sens.
    if (manifest?.core) {
      throw new BadRequestException(`Le module core "${moduleId}" n'est pas désactivable`);
    }
    await this.prisma.moduleState.upsert({
      where: { id: moduleId },
      create: { id: moduleId, enabled },
      update: { enabled },
    });
    this.enabledCache.set(moduleId, enabled);
    this.eventBus.emit(enabled ? EVENTS.moduleEnabled : EVENTS.moduleDisabled, { moduleId, enabled });
    this.logger.log(`Module ${moduleId} → ${enabled ? 'activé' : 'désactivé'}`);
  }
}
