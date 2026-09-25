-- Portée « famille » d'une règle d'exclusion : le même workflow métier dans tous
-- ses environnements (dev/preprod/prod). Null = la portée reste celle d'avant
-- (workflowId seul, ou globale).
ALTER TABLE "FindingIgnore" ADD COLUMN "familyKey" TEXT;

CREATE INDEX "FindingIgnore_familyKey_idx" ON "FindingIgnore"("familyKey");

-- La règle js-console-log n'existe plus : un console.log n'est visible que dans
-- l'exécution n8n, derrière un compte admin. On efface les findings déjà émis
-- (sinon ils survivent jusqu'à la prochaine analyse du workflow) et les règles
-- d'exclusion qui ne visent plus rien.
DELETE FROM "Finding" WHERE "code" = 'js-console-log';
DELETE FROM "FindingIgnore" WHERE "code" = 'js-console-log';
