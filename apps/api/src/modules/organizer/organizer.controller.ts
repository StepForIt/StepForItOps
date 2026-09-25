import { Body, Controller, Param, Post } from '@nestjs/common';
import { OrganizePlanItem, OrganizerService } from './organizer.service';
import { ModuleId } from '../../infra/modules-registry/module-id.decorator';

@ModuleId('organizer')
@Controller('organizer')
export class OrganizerController {
  constructor(private readonly organizer: OrganizerService) {}

  @Post('plan/:instanceId')
  plan(
    @Param('instanceId') instanceId: string,
    @Body() body: { convention?: string },
  ): Promise<OrganizePlanItem[]> {
    return this.organizer.plan(instanceId, body?.convention);
  }

  @Post('apply')
  apply(@Body() body: { items: OrganizePlanItem[] }): Promise<{ applied: number }> {
    return this.organizer.apply(body.items ?? []);
  }
}
