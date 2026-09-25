import { Body, Controller, Delete, Get, Headers, Param, Put } from '@nestjs/common';
import { WorkflowLock } from '@prisma/client';
import { WorkflowLockDetail, WorkflowLockService } from './workflow-lock.service';

/** Hors module métier : un verrou qu'on éteindrait avec un module ne garantirait rien. */
@Controller('workflow-locks')
export class WorkflowLockController {
  constructor(private readonly locks: WorkflowLockService) {}

  @Get()
  list(): Promise<WorkflowLock[]> {
    return this.locks.list();
  }

  @Get(':workflowId')
  detail(@Param('workflowId') workflowId: string): Promise<WorkflowLockDetail> {
    return this.locks.detail(workflowId);
  }

  @Put(':workflowId')
  lock(
    @Param('workflowId') workflowId: string,
    @Body() body: { note?: string },
    @Headers('x-user-email') email?: string,
  ): Promise<WorkflowLock> {
    return this.locks.lock(workflowId, email, body?.note);
  }

  @Delete(':workflowId')
  async unlock(@Param('workflowId') workflowId: string): Promise<{ ok: true }> {
    await this.locks.unlock(workflowId);
    return { ok: true };
  }
}
