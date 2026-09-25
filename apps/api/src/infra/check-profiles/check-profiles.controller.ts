import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CHECK_CATALOG, CHECK_GROUPS, CheckScope, SaveDecision } from '@nwm/core';
import { ApplyResult, CheckProfilesService, ResolvedProfileView } from './check-profiles.service';

export interface SelectionBody {
  disabled?: string[];
  scope?: CheckScope;
}

/**
 * Sélection des contrôles d'analyse. Hors module métier : les quatre modules
 * d'analyse la lisent, et la page de lancement l'écrit — un module désactivable
 * ne peut porter ni l'un ni l'autre.
 */
@Controller('check-profiles')
export class CheckProfilesController {
  constructor(private readonly profiles: CheckProfilesService) {}

  /** Catalogue des contrôles : c'est lui qui peuple les cases à cocher. */
  @Get('catalog')
  catalog() {
    return { groups: CHECK_GROUPS, checks: CHECK_CATALOG };
  }

  @Get()
  list() {
    return this.profiles.list();
  }

  @Get('resolve/:workflowId')
  resolve(@Param('workflowId') workflowId: string): Promise<ResolvedProfileView> {
    return this.profiles.resolve(workflowId);
  }

  /** Portée que prendrait cet enregistrement, sans rien écrire. */
  @Post('plan/:workflowId')
  plan(@Param('workflowId') workflowId: string, @Body() body: SelectionBody): Promise<SaveDecision> {
    return this.profiles.plan(workflowId, body.disabled ?? []);
  }

  @Post('apply/:workflowId')
  apply(@Param('workflowId') workflowId: string, @Body() body: SelectionBody): Promise<ApplyResult> {
    return this.profiles.apply(workflowId, body.disabled ?? [], body.scope);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.profiles.remove(id);
  }
}
