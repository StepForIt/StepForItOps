-- Schémas de nœuds PAR VERSION, tels que l'instance les décrit.
-- `/types/nodes.json` ne sert que la description courante d'un type, quand plus
-- d'un nœud sur deux tourne sur une version antérieure : sans schéma daté, la
-- règle « version pour version » fait taire le contrôle sur la moitié du parc.

CREATE TABLE "InstanceNodeTypeVersion" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "version" DOUBLE PRECISION NOT NULL,
    "displayName" TEXT NOT NULL,
    "properties" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstanceNodeTypeVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstanceNodeTypeVersion_instanceId_nodeType_version_key"
    ON "InstanceNodeTypeVersion"("instanceId", "nodeType", "version");

CREATE INDEX "InstanceNodeTypeVersion_instanceId_nodeType_idx"
    ON "InstanceNodeTypeVersion"("instanceId", "nodeType");

ALTER TABLE "InstanceNodeTypeVersion" ADD CONSTRAINT "InstanceNodeTypeVersion_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "N8nInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
