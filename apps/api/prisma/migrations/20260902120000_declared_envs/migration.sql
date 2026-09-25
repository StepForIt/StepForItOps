-- Environnements déclarés : la liste n'est plus figée à dev/preprod/prod.
-- Colonne nullable : une ligne sans `envs` est relue depuis `envChain`, qui reste
-- en place tant que des installations en cours de route s'y réfèrent.
ALTER TABLE "PlatformSettings" ADD COLUMN "envs" JSONB;
