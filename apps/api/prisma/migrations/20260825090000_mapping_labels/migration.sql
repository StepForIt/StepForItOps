-- Nom lisible de chaque ressource mappée, par env : sans lui, une bascule remplace
-- l'id mais laisse le libellé affiché par n8n (cachedResultName) sur l'ancien nom.
ALTER TABLE "ResourceMapping" ADD COLUMN "labels" JSONB;
