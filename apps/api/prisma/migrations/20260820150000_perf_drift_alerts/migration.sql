-- Alerte de dérive de durée : état « déjà signalée » par workflow (hystérésis),
-- et le toggle correspondant sur les canaux du notifier.
CREATE TABLE "PerfDriftAlert" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "n8nWorkflowId" TEXT NOT NULL,
    "ratio" DOUBLE PRECISION NOT NULL,
    "alertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerfDriftAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PerfDriftAlert_instanceId_n8nWorkflowId_key" ON "PerfDriftAlert"("instanceId", "n8nWorkflowId");

ALTER TABLE "NotificationChannel" ADD COLUMN "onPerfDrift" BOOLEAN NOT NULL DEFAULT true;
