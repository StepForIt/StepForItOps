-- Alerte de budget du module ai-cost : réglage (budget quotidien USD, dernier jour
-- alerté) et opt-in par canal de notification.

ALTER TABLE "NotificationChannel" ADD COLUMN "onBudget" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "AiCostSettings" (
    "id" TEXT NOT NULL,
    "dailyBudgetUsd" DOUBLE PRECISION,
    "lastAlertedDate" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCostSettings_pkey" PRIMARY KEY ("id")
);
