-- Le graphe de dépendances persisté (DepNode / DepEdge) est supprimé : les
-- dépendances sont désormais relues à la volée depuis Workflow.raw, il n'y a
-- plus rien à reconstruire. Données purement dérivées, rien à conserver.
--
-- IF EXISTS : sur une base neuve, 0_init ne les a jamais créées.
DROP TABLE IF EXISTS "DepEdge";
DROP TABLE IF EXISTS "DepNode";
