import { Module } from '@nestjs/common';
import { JsCheckerController } from './js-checker.controller';
import { JsCheckerService } from './js-checker.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { manifestProvider } from '../../infra/modules-registry/manifest.provider';
import { JS_CHECKER_MANIFEST } from './manifest';

@Module({
  imports: [WorkflowsModule],
  controllers: [JsCheckerController],
  providers: [JsCheckerService, manifestProvider(JS_CHECKER_MANIFEST)],
})
export class JsCheckerModule {}
