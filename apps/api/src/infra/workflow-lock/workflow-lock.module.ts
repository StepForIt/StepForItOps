import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { LockContextMiddleware } from './lock-context.middleware';
import { WorkflowLockController } from './workflow-lock.controller';
import { WorkflowLockService } from './workflow-lock.service';

/** Global : chaque module qui écrit vers n8n ou Make passe par ce garde, sans l'importer. */
@Global()
@Module({
  controllers: [WorkflowLockController],
  providers: [WorkflowLockService],
  exports: [WorkflowLockService],
})
export class WorkflowLockModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LockContextMiddleware).forRoutes('*');
  }
}
