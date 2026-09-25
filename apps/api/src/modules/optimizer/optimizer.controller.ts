import { Body, Controller, Param, Post } from '@nestjs/common';
import { Finding } from '@prisma/client';
import { OptimizerService, RenameSuggestion, RenameWithNote, SuggestNamesOptions } from './optimizer.service';
import { StickySuggestion, StickySuggestionsService } from './sticky-suggestions.service';
import { StickyApplySpec } from './apply-stickies';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';

@ModuleId('optimizer')
@Controller('optimizer')
export class OptimizerController {
  constructor(
    private readonly optimizer: OptimizerService,
    private readonly stickySuggestions: StickySuggestionsService,
  ) {}

  /** Corps optionnel `{ disabled: string[] }` : contrôles décochés pour ce lancement. */
  @Post('analyze/:workflowId')
  analyze(
    @Param('workflowId') workflowId: string,
    @Body() body?: { disabled?: string[] },
  ): Promise<Finding[]> {
    return this.optimizer.analyze(workflowId, body?.disabled);
  }

  @Post('suggest-names/:workflowId')
  suggest(
    @Param('workflowId') workflowId: string,
    @Body() body: SuggestNamesOptions = {},
  ): Promise<RenameSuggestion[]> {
    return this.optimizer.suggestNames(workflowId, body);
  }

  @Post('apply-renames/:workflowId')
  apply(
    @Param('workflowId') workflowId: string,
    @Body() body: { renames: RenameWithNote[] },
  ): Promise<{ renamed: number }> {
    return this.optimizer.applyRenames(workflowId, body.renames ?? []);
  }

  @Post('suggest-stickies/:workflowId')
  suggestStickies(@Param('workflowId') workflowId: string): Promise<StickySuggestion[]> {
    return this.stickySuggestions.suggestStickies(workflowId);
  }

  @Post('apply-stickies/:workflowId')
  applyStickies(
    @Param('workflowId') workflowId: string,
    @Body() body: { stickies: StickyApplySpec[] },
  ): Promise<{ applied: number }> {
    return this.stickySuggestions.applyStickies(workflowId, body.stickies ?? []);
  }
}
