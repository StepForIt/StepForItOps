-- Marque « ce problème a déjà été annoncé » : sans elle, un groupe provisoire
-- (signature « (sans détail) ») repartait en « nouveau problème » à chaque exécution.
ALTER TABLE "ErrorGroup" ADD COLUMN "notifiedAt" TIMESTAMP(3);

-- Les groupes déjà connus ont déjà donné lieu à leur alerte : on les considère annoncés,
-- sinon la première occurrence d'après le déploiement rejouerait toutes les alertes.
UPDATE "ErrorGroup" SET "notifiedAt" = "createdAt";
