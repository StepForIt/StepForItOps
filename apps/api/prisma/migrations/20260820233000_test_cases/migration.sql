-- Cas de test enregistrés depuis des exécutions réelles (module tester) :
-- payload à rejouer + snapshot attendu, dernier statut pour le gate de promotion.
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB,
    "expected" JSONB NOT NULL,
    "sourceExecutionId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastStatus" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastDiff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TestCase_workflowId_idx" ON "TestCase"("workflowId");

ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
