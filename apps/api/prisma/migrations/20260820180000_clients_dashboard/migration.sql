-- Cockpit d'agence : clients (groupes d'instances), temps gagné par workflow,
-- et dernière visite du dashboard par utilisateur.
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Client_name_key" ON "Client"("name");

ALTER TABLE "N8nInstance" ADD COLUMN "clientId" TEXT;

ALTER TABLE "N8nInstance" ADD CONSTRAINT "N8nInstance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Workflow" ADD COLUMN "minutesSavedPerExecution" DOUBLE PRECISION;

CREATE TABLE "DashboardVisit" (
    "userEmail" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardVisit_pkey" PRIMARY KEY ("userEmail")
);
