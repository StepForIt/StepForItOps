-- Module performance : historisation maigre des exécutions (durées + statut) pour
-- les tendances par workflow, et curseur de poll par instance.

CREATE TABLE "ExecutionStat" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "n8nWorkflowId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "stoppedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "ExecutionStat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExecutionStatCursor" (
    "instanceId" TEXT NOT NULL,
    "lastSeenExecutionId" TEXT,
    "lastPolledAt" TIMESTAMP(3),

    CONSTRAINT "ExecutionStatCursor_pkey" PRIMARY KEY ("instanceId")
);

CREATE UNIQUE INDEX "ExecutionStat_instanceId_executionId_key" ON "ExecutionStat"("instanceId", "executionId");

CREATE INDEX "ExecutionStat_instanceId_n8nWorkflowId_startedAt_idx" ON "ExecutionStat"("instanceId", "n8nWorkflowId", "startedAt");

CREATE INDEX "ExecutionStat_instanceId_startedAt_idx" ON "ExecutionStat"("instanceId", "startedAt");

ALTER TABLE "ExecutionStat" ADD CONSTRAINT "ExecutionStat_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "N8nInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExecutionStatCursor" ADD CONSTRAINT "ExecutionStatCursor_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "N8nInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
