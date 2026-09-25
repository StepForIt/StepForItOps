-- Alerter quand le relais vers la sonde de monitoring est coupé (la surveillance elle-même).
ALTER TABLE "NotificationChannel" ADD COLUMN "onRelayBroken" BOOLEAN NOT NULL DEFAULT true;
