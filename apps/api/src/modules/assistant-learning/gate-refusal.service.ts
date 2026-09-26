import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AssistantDraftRepairedEvent, EVENTS } from '@nwm/core';
import { ModuleRegistryService } from '../../infra/modules-registry/module-registry.service';
import { ASSISTANT_LEARNING_MANIFEST } from './manifest';
import { LessonDistillService } from './lesson-distill.service';

/**
 * Apprend des refus de porte que l'assistant a lui-même corrigés.
 *
 * C'est le second signal à preuve, et le plus fréquent : la porte rejoue des
 * contrôles DÉTERMINISTES sur le brouillon, le refuse, le modèle corrige, et le
 * même contrôle passe. Rouge puis vert, sans qu'aucun modèle n'ait eu son mot à
 * dire sur le verdict — c'est ce qui le distingue d'une auto-évaluation, où
 * l'assistant se relirait et se confirmerait.
 *
 * L'intérêt n'est pas le tour où ça se produit : `draft-repair` l'a déjà rattrapé
 * tout seul. Il est ailleurs — la même faute sur le même TYPE de nœud se rejouera
 * dans un autre workflow, et une règle servie d'entrée épargne la passe de
 * correction entière, avec l'appel IA qu'elle coûte.
 *
 * Un brouillon resté refusé n'émet rien : on sait qu'il était faux, on ne sait
 * pas ce qu'il aurait fallu écrire, et une règle tirée de là serait une
 * interdiction sans alternative.
 */
@Injectable()
export class GateRefusalService {
  private readonly logger = new Logger(GateRefusalService.name);

  constructor(
    private readonly registry: ModuleRegistryService,
    private readonly distill: LessonDistillService,
  ) {}

  @OnEvent(EVENTS.assistantDraftRepaired)
  async onDraftRepaired(event: AssistantDraftRepairedEvent): Promise<void> {
    if (!(await this.registry.isEnabled(ASSISTANT_LEARNING_MANIFEST.id))) return;
    try {
      await this.distill.fromGateRefusal(event);
    } catch (error) {
      // Apprendre est un bonus : jamais au prix du tour qui a émis l'événement.
      this.logger.warn(`Gate refusal not used (${event.workflowId}): ${(error as Error).message}`);
    }
  }
}
