-- Une règle d'exclusion était identifiée par des NOMS : familyKey dérivée du nom du
-- workflow, nodeName du nom du nœud. Un renommage — y compris celui que propose le
-- module optimizer — rendait la règle caduque sans le dire, et le finding déclaré
-- normal revenait à l'analyse suivante. On ancre donc la règle sur des identifiants
-- stables, et on garde le message d'origine : c'est lui qu'on donne aux revues IA
-- pour qu'elles cessent de resignaler ce qui est déjà déclaré normal.
ALTER TABLE "FindingIgnore" ADD COLUMN "familyWorkflowId" TEXT;
ALTER TABLE "FindingIgnore" ADD COLUMN "nodeId" TEXT;
ALTER TABLE "FindingIgnore" ADD COLUMN "message" TEXT;
ALTER TABLE "FindingIgnore" ADD COLUMN "messageKey" TEXT;

CREATE INDEX "FindingIgnore_familyWorkflowId_idx" ON "FindingIgnore"("familyWorkflowId");

-- Pas de reprise en SQL des règles existantes : retrouver le workflow d'une famille
-- demande de retirer préfixe d'archivage et suffixe d'env du nom (workflow-family.ts),
-- que Postgres ne sait pas calculer ; un LIKE approché ancrerait certaines règles sur
-- le mauvais workflow, ce qui est pire que pas d'ancre. Elles continuent donc de
-- s'apparier par familyKey, et le service pose l'ancre au premier appariement.
