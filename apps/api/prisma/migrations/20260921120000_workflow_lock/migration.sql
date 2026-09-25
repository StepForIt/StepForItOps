-- CreateTable
CREATE TABLE "WorkflowLock" (
    "workflowId" TEXT NOT NULL,
    "lockedBy" TEXT,
    "note" TEXT,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowLock_pkey" PRIMARY KEY ("workflowId")
);

-- CreateTable
CREATE TABLE "WorkflowLockOverride" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "author" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowLockOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowLockOverride_workflowId_createdAt_idx" ON "WorkflowLockOverride"("workflowId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkflowLock" ADD CONSTRAINT "WorkflowLock_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowLockOverride" ADD CONSTRAINT "WorkflowLockOverride_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
