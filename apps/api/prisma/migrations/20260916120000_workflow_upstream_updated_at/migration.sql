-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "upstreamUpdatedAt" TIMESTAMP(3);

-- Les workflows n8n portent déjà la date dans leur JSON : pas besoin d'attendre la prochaine synchro.
UPDATE "Workflow" SET "upstreamUpdatedAt" = ("raw"->>'updatedAt')::timestamptz
WHERE jsonb_typeof("raw"->'updatedAt') = 'string';
