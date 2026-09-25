-- Surveillance des erreurs limitée à la PROD (cf. isMonitoredEnv) : rétroactif.
-- L'historique déjà en base garderait sinon indéfiniment les erreurs de dev et de
-- preprod — courbes, heatmap et problèmes ouverts continueraient de les compter.
-- Un env INDÉTERMINÉ est conservé : c'est la même règle qu'à l'ingestion, et un
-- parc non étiqueté serait sinon effacé en entier.
--
-- La détection reprend `detectWorkflowEnv` : tag `env:<name>` prioritaire, sinon
-- suffixe du nom (« X - DEV », « X [preprod] »). Un tag `env:prod` l'emporte sur
-- tout le reste — dans le doute on garde.
WITH non_prod AS (
  SELECT w."instanceId", w."n8nId"
  FROM "Workflow" w
  WHERE NOT EXISTS (
      SELECT 1 FROM unnest(w.tags) AS t WHERE lower(t) = 'env:prod'
    )
    AND (
      EXISTS (
        SELECT 1 FROM unnest(w.tags) AS t WHERE lower(t) IN ('env:dev', 'env:preprod')
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM unnest(w.tags) AS t WHERE lower(t) LIKE 'env:%'
        )
        AND w.name ~* '[ \t_\-\[(](dev|preprod)[)\] \t]*$'
      )
    )
)
DELETE FROM "ExecutionError" e
USING non_prod n
WHERE e."instanceId" = n."instanceId"
  AND e."n8nWorkflowId" = n."n8nId";

-- Un groupe est le résumé de ses occurrences : celles qui restent recalculent ses
-- compteurs (jamais d'incrément, cf. `recount`), et un groupe vidé n'a plus d'objet
-- — son journal part en cascade.
UPDATE "ErrorGroup" g
SET occurrences = s.total,
    "firstSeenAt" = s.first_seen,
    "lastSeenAt" = s.last_seen,
    "updatedAt" = now()
FROM (
  SELECT "groupId" AS id,
         count(*) AS total,
         min("startedAt") AS first_seen,
         max("startedAt") AS last_seen
  FROM "ExecutionError"
  WHERE "groupId" IS NOT NULL
  GROUP BY "groupId"
) s
WHERE g.id = s.id
  AND (g.occurrences <> s.total OR g."firstSeenAt" <> s.first_seen OR g."lastSeenAt" <> s.last_seen);

DELETE FROM "ErrorGroup" g
WHERE NOT EXISTS (SELECT 1 FROM "ExecutionError" e WHERE e."groupId" = g.id);
