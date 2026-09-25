-- Estimation par défaut du temps gagné : le champ saisi à la main restait vide
-- sur tout le parc, donc le ROI du dashboard valait zéro pour tout le monde.
-- L'estimation vit dans SES propres colonnes : la saisie humaine est la vérité,
-- et une estimation qui l'écraserait ferait perdre le seul chiffre mesuré.
ALTER TABLE "Workflow" ADD COLUMN "minutesSavedEstimate" DOUBLE PRECISION;
ALTER TABLE "Workflow" ADD COLUMN "minutesSavedEstimateWhy" TEXT;
ALTER TABLE "Workflow" ADD COLUMN "minutesSavedEstimateFrom" TEXT;
