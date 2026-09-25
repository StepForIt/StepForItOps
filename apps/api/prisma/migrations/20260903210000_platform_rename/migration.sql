-- Le miroir ne parle plus « n8n » mais « la plateforme d'origine » : une instance
-- pourra être un compte Make, dont les scénarios ont un id, un archivage et une
-- disparition tout aussi réels.
--
-- RENAME et jamais DROP/CREATE : ces tables portent l'historique — versions,
-- erreurs groupées, statistiques d'exécution — que rien ne saurait reconstruire,
-- la plateforme d'origine ne gardant pas ce qu'on garde ici.

ALTER TABLE "N8nInstance" RENAME TO "Instance";
ALTER INDEX "N8nInstance_pkey" RENAME TO "Instance_pkey";
-- La clé étrangère dont l'instance est la SOURCE porte le nom de la table, elle
-- aussi : renommer la table ne la renomme pas.
ALTER TABLE "Instance" RENAME CONSTRAINT "N8nInstance_clientId_fkey" TO "Instance_clientId_fkey";

ALTER TABLE "Workflow" RENAME COLUMN "n8nId" TO "externalId";
ALTER TABLE "Workflow" RENAME COLUMN "archivedInN8n" TO "archivedUpstream";
ALTER TABLE "Workflow" RENAME COLUMN "missingInN8nAt" TO "missingUpstreamAt";
ALTER INDEX "Workflow_instanceId_n8nId_key" RENAME TO "Workflow_instanceId_externalId_key";

ALTER TABLE "ExecutionError" RENAME COLUMN "n8nWorkflowId" TO "externalWorkflowId";

ALTER TABLE "ErrorGroup" RENAME COLUMN "n8nWorkflowId" TO "externalWorkflowId";

ALTER TABLE "ExecutionStat" RENAME COLUMN "n8nWorkflowId" TO "externalWorkflowId";
ALTER INDEX "ExecutionStat_instanceId_n8nWorkflowId_startedAt_idx" RENAME TO "ExecutionStat_instanceId_externalWorkflowId_startedAt_idx";

ALTER TABLE "LlmUsage" RENAME COLUMN "n8nWorkflowId" TO "externalWorkflowId";
ALTER INDEX "LlmUsage_instanceId_n8nWorkflowId_startedAt_idx" RENAME TO "LlmUsage_instanceId_externalWorkflowId_startedAt_idx";

ALTER TABLE "PerfDriftAlert" RENAME COLUMN "n8nWorkflowId" TO "externalWorkflowId";
ALTER INDEX "PerfDriftAlert_instanceId_n8nWorkflowId_key" RENAME TO "PerfDriftAlert_instanceId_externalWorkflowId_key";

-- Ce que l'instance doit déclarer d'elle-même pour qu'on sache lire son `raw`.
-- `platform` a une valeur par défaut : tout ce qui existe aujourd'hui est du n8n,
-- et aucune ligne ne doit être touchée à la main au déploiement.
ALTER TABLE "Instance" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'n8n';
ALTER TABLE "Instance" ADD COLUMN "zone" TEXT;
ALTER TABLE "Instance" ADD COLUMN "externalOrgId" TEXT;
ALTER TABLE "Instance" ADD COLUMN "externalTeamId" TEXT;
