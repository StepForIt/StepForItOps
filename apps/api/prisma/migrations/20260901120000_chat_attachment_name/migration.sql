-- Nom d'origine d'une pièce jointe : nul pour les captures déjà en base, qui n'en ont jamais eu.
ALTER TABLE "WorkflowChatAttachment" ADD COLUMN "name" TEXT;
