-- Résumé du raisonnement du modèle, tour par tour, à côté de la trace des outils.
-- Le renvoi de ce résumé est optionnel côté API et omis par défaut ; le
-- raisonnement, lui, a lieu et est facturé quoi qu'il arrive.
ALTER TABLE "WorkflowChatMessage" ADD COLUMN "thinking" JSONB;
