-- Audit des modèles IA.
--
-- `ModelPrice` devient `ModelCatalog` : une table qui porte un statut, des
-- aptitudes et un successeur ne s'appelle pas « prix ». RENAME et jamais
-- DROP/CREATE — les lignes `custom` sont les seules que quelqu'un ait décidées
-- à la main, et les coûts déjà figés dans LlmUsage en dépendent.
ALTER TABLE "ModelPrice" RENAME TO "ModelCatalog";
ALTER INDEX "ModelPrice_pkey" RENAME TO "ModelCatalog_pkey";
ALTER INDEX "ModelPrice_pattern_key" RENAME TO "ModelCatalog_pattern_key";

-- Les aptitudes sont NULLABLES à dessein : une aptitude inconnue n'est pas une
-- aptitude absente, et le contrôle correspondant se tait au lieu d'accuser.
ALTER TABLE "ModelCatalog"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "deprecatedAt" TIMESTAMP(3),
  ADD COLUMN "retiresAt" TIMESTAMP(3),
  ADD COLUMN "replacedByPattern" TEXT,
  ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN "supportsVision" BOOLEAN,
  ADD COLUMN "supportsTools" BOOLEAN,
  ADD COLUMN "supportsStructuredOutput" BOOLEAN,
  ADD COLUMN "contextWindow" INTEGER,
  ADD COLUMN "maxOutputTokens" INTEGER,
  ADD COLUMN "weakAtTasks" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "ModelCatalogProposal" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "currentValue" JSONB,
    "proposedValue" JSONB,
    "origin" TEXT NOT NULL,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),

    CONSTRAINT "ModelCatalogProposal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ModelCatalogProposal_pattern_field_key" ON "ModelCatalogProposal"("pattern", "field");
CREATE INDEX "ModelCatalogProposal_appliedAt_idx" ON "ModelCatalogProposal"("appliedAt");

CREATE TABLE "ModelTaskProfile" (
    "task" TEXT NOT NULL,
    "minTier" TEXT NOT NULL,
    "rationale" TEXT,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelTaskProfile_pkey" PRIMARY KEY ("task")
);

CREATE TABLE "LlmNodeTask" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeName" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmNodeTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LlmNodeTask_workflowId_nodeName_key" ON "LlmNodeTask"("workflowId", "nodeName");
CREATE INDEX "LlmNodeTask_task_idx" ON "LlmNodeTask"("task");
ALTER TABLE "LlmNodeTask" ADD CONSTRAINT "LlmNodeTask_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ModelAuditSettings" (
    "id" TEXT NOT NULL,
    "savingsThresholdPct" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "minAnnualSavingsUsd" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "catalogStaleDays" INTEGER NOT NULL DEFAULT 60,
    "minTaskConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "lifecycleArmed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelAuditSettings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "NotificationChannel" ADD COLUMN "onModelLifecycle" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "ModelCatalogSync" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "revision" TEXT,
    "proposed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelCatalogSync_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ModelCatalogSync_source_at_idx" ON "ModelCatalogSync"("source", "at");

CREATE TABLE "ModelLifecycleAlert" (
    "pattern" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "alertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelLifecycleAlert_pkey" PRIMARY KEY ("pattern")
);
