-- CreateIndex
CREATE INDEX "EventLog_name_createdAt_idx" ON "EventLog"("name", "createdAt");

-- Journal allégé : les payloads déjà écrits portaient le workflow entier
-- (`workflow.synced`). Même règle que l'écriture (`eventLogPayload`) : une clé
-- de plus de 1 Ko est remplacée par sa taille, les ids restent. La place se
-- libère au VACUUM suivant (autovacuum, ou VACUUM FULL pour la rendre au disque).
UPDATE "EventLog"
SET "payload" = (
  SELECT jsonb_object_agg(
    k,
    CASE WHEN octet_length(v::text) > 1024 THEN jsonb_build_object('omittedBytes', octet_length(v::text)) ELSE v END
  )
  FROM jsonb_each("payload") AS t(k, v)
)
WHERE jsonb_typeof("payload") = 'object' AND octet_length("payload"::text) > 1024;
