-- Catégorie d'un groupe d'erreurs (auth | rate-limit | timeout | network | data | other),
-- déduite du message par categorizeError(). Les groupes existants partent sur "other" :
-- ils seront recatégorisés depuis leur sample (POST /error-groups/recategorize), et les
-- nouvelles occurrences recalculent la catégorie au fil de l'eau.
ALTER TABLE "ErrorGroup" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'other';
