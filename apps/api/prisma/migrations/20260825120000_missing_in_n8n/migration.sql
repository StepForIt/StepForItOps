-- Workflows que n8n ne renvoie plus : archivés nativement (resynchronisés à l'unité)
-- ou supprimés côté n8n (marqués ici, jamais effacés de la plateforme).
ALTER TABLE "Workflow" ADD COLUMN "missingInN8nAt" TIMESTAMP(3);

ALTER TABLE "PlatformSettings" ADD COLUMN "includeMissing" BOOLEAN NOT NULL DEFAULT false;

-- Archivage natif n8n sorti du JSON : une condition `NOT` sur un chemin JSON
-- absent vaut NULL, donc écarte la ligne — un workflow synchronisé par une
-- version de n8n sans `isArchived` disparaissait des listes par défaut.
ALTER TABLE "Workflow" ADD COLUMN "archivedInN8n" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Workflow" SET "archivedInN8n" = true WHERE "raw" -> 'isArchived' = 'true'::jsonb;
