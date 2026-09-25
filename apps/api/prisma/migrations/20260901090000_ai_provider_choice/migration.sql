-- Une ligne AiSettings par fournisseur ; `active` désigne celui qui sert les appels.
ALTER TABLE "AiSettings" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT false;

-- Les installations existantes n'ont que la ligne "anthropic" : elle reste servie.
UPDATE "AiSettings" SET "active" = true WHERE "id" = 'anthropic';
