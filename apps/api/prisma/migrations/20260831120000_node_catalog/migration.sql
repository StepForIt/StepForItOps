-- Catalogue des types de nœuds n8n : ce que n8n dit de ses propres nœuds.
-- Deux sources, deux tables (catalogue mutualisé / instance), l'instance primant
-- à la lecture. Le catalogue est stocké chez nous pour survivre à son amont.

ALTER TABLE "N8nInstance" ADD COLUMN "n8nEmail" TEXT;
ALTER TABLE "N8nInstance" ADD COLUMN "n8nPassword" TEXT;

CREATE TABLE "NodeType" (
    "nodeType" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "version" DOUBLE PRECISION,
    "isTrigger" BOOLEAN NOT NULL DEFAULT false,
    "isWebhook" BOOLEAN NOT NULL DEFAULT false,
    "isVersioned" BOOLEAN NOT NULL DEFAULT false,
    "properties" JSONB NOT NULL,
    "operations" JSONB,
    "credentials" JSONB,
    "documentation" TEXT,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeType_pkey" PRIMARY KEY ("nodeType")
);

CREATE INDEX "NodeType_source_idx" ON "NodeType"("source");

CREATE TABLE "InstanceNodeType" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "version" DOUBLE PRECISION,
    "versions" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "isTrigger" BOOLEAN NOT NULL DEFAULT false,
    "isWebhook" BOOLEAN NOT NULL DEFAULT false,
    "properties" JSONB NOT NULL,
    "credentials" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstanceNodeType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstanceNodeType_instanceId_nodeType_key" ON "InstanceNodeType"("instanceId", "nodeType");
CREATE INDEX "InstanceNodeType_instanceId_idx" ON "InstanceNodeType"("instanceId");

ALTER TABLE "InstanceNodeType" ADD CONSTRAINT "InstanceNodeType_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "N8nInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NodeCatalogSync" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "revision" TEXT,
    "n8nVersion" TEXT,
    "added" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "removed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeCatalogSync_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NodeCatalogSync_source_at_idx" ON "NodeCatalogSync"("source", "at");
