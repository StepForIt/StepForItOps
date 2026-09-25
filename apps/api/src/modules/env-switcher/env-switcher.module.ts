import { Module } from '@nestjs/common';
import { EnvSwitcherController } from './env-switcher.controller';
import { EnvSwitcherService } from './env-switcher.service';
import { EnvDuplicatorService } from './env-duplicator.service';
import { GroupDuplicatorService } from './group-duplicator.service';
import { WebhookPathFixService } from './webhook-path-fix.service';
import { BulkEnvPlanService } from './bulk-env-plan.service';
import { InstancePromoterService } from './instance-promoter.service';
import { PromoteDefaultsService } from './promote-defaults.service';
import { PromotionPublishService } from './promotion-publish.service';
import { ReleaseStateService } from './release-state.service';
import { VersionProposalService } from './version-proposal.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { InstancesModule } from '../instances/instances.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { ENV_SWITCHER_MANIFEST } from './manifest';

@Module({
  imports: [WorkflowsModule, InstancesModule],
  controllers: [EnvSwitcherController],
  providers: [
    EnvSwitcherService,
    EnvDuplicatorService,
    GroupDuplicatorService,
    InstancePromoterService,
    PromoteDefaultsService,
    PromotionPublishService,
    ReleaseStateService,
    VersionProposalService,
    WebhookPathFixService,
    BulkEnvPlanService,
    manifestProvider(ENV_SWITCHER_MANIFEST),
  ],
})
export class EnvSwitcherModule {}
