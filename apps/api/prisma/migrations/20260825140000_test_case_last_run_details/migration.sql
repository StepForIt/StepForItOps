-- Le résultat d'un rejeu ne doit pas tenir que dans un toast : la raison d'un
-- statut « error » et l'exécution n8n déclenchée restent lisibles après rechargement.
ALTER TABLE "TestCase" ADD COLUMN "lastMessage" TEXT;
ALTER TABLE "TestCase" ADD COLUMN "lastExecutionId" TEXT;
