-- Module ai-cost : appels LLM extraits du runData des exécutions (tokens + coût
-- figé à l'ingestion), curseur de poll par instance et table de tarifs par modèle.

CREATE TABLE "LlmUsage" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "n8nWorkflowId" TEXT NOT NULL,
    "nodeName" TEXT NOT NULL,
    "runIndex" INTEGER NOT NULL,
    "callIndex" INTEGER NOT NULL,
    "itemIndex" INTEGER NOT NULL,
    "model" TEXT,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "isEstimate" BOOLEAN NOT NULL DEFAULT false,
    "costUsd" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LlmUsageCursor" (
    "instanceId" TEXT NOT NULL,
    "lastSeenExecutionId" TEXT,
    "lastPolledAt" TIMESTAMP(3),

    CONSTRAINT "LlmUsageCursor_pkey" PRIMARY KEY ("instanceId")
);

CREATE TABLE "ModelPrice" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "inputPerMTok" DOUBLE PRECISION NOT NULL,
    "outputPerMTok" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LlmUsage_instanceId_executionId_nodeName_runIndex_callIndex_key" ON "LlmUsage"("instanceId", "executionId", "nodeName", "runIndex", "callIndex", "itemIndex");

CREATE INDEX "LlmUsage_instanceId_startedAt_idx" ON "LlmUsage"("instanceId", "startedAt");

CREATE INDEX "LlmUsage_instanceId_n8nWorkflowId_startedAt_idx" ON "LlmUsage"("instanceId", "n8nWorkflowId", "startedAt");

CREATE UNIQUE INDEX "ModelPrice_pattern_key" ON "ModelPrice"("pattern");

ALTER TABLE "LlmUsage" ADD CONSTRAINT "LlmUsage_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "N8nInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LlmUsageCursor" ADD CONSTRAINT "LlmUsageCursor_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "N8nInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
