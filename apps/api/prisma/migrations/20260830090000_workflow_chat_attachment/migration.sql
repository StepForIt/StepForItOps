-- Captures d'écran jointes aux messages du chat IA.
CREATE TABLE "WorkflowChatAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowChatAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowChatAttachment_messageId_idx" ON "WorkflowChatAttachment"("messageId");

ALTER TABLE "WorkflowChatAttachment" ADD CONSTRAINT "WorkflowChatAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WorkflowChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
