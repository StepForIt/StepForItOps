-- Version sémantique portée par chaque exemplaire, posée par la promotion.
ALTER TABLE "Workflow" ADD COLUMN "version" TEXT;

-- Version publiée par la promotion qui a produit ce snapshot (null pour une synchro).
ALTER TABLE "WorkflowVersion" ADD COLUMN "semver" TEXT;

-- Chaîne de promotion déclarée, et ce qu'on fait quand on la saute.
ALTER TABLE "PlatformSettings" ADD COLUMN "envChain" TEXT[] NOT NULL DEFAULT ARRAY['dev', 'preprod', 'prod']::TEXT[];
ALTER TABLE "PlatformSettings" ADD COLUMN "envChainMode" TEXT NOT NULL DEFAULT 'warn';
