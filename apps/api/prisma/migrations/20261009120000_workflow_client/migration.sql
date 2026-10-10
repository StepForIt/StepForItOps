-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "portalShowIncidents" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "portalShowToday" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "publicName" TEXT;

-- CreateIndex
CREATE INDEX "Workflow_clientId_idx" ON "Workflow"("clientId");

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
