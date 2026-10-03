# Chiffrement des secrets d'instance

Les clés API des instances et les mots de passe des comptes n8n sont **chiffrés
dans la base**. Une copie de la base seule (sauvegarde, dump égaré) ne livre
plus les accès aux n8n des clients : il faut aussi la clé, qui vit ailleurs.

```
console ──► API ──► Prisma (chiffre / déchiffre) ──► base : enc:v1:…
                         ▲
              SECRETS_KEY (variable d'env, hors de la base)
```

## Activer

1. Générer une clé : `openssl rand -base64 32`.
2. La poser dans l'environnement de l'API : `SECRETS_KEY=…` (Dokploy, `.env`).
3. Redéployer. Au démarrage, l'API chiffre les secrets encore en clair, une
   seule fois, et l'écrit dans ses logs (« Encrypted the secrets of N
   instance(s) at rest »).

Sans `SECRETS_KEY`, rien ne change : les secrets restent en clair et la console
l'affiche dans sa bannière de sécurité.

## À savoir avant de la poser

| Situation | Ce qui se passe |
|---|---|
| Clé perdue ou retirée, secrets déjà chiffrés | l'API **refuse de démarrer**, avec un message qui le dit |
| Autre clé que celle du chiffrement | même refus : rien n'est envoyé à n8n avec une clé illisible |
| Clé perdue pour de bon | la retirer, vider les secrets en base, puis ressaisir clé API et compte de chaque instance |

Conserver la clé dans le coffre de l'équipe, à côté des autres secrets de
déploiement. Elle ne se change pas encore à chaud (pas de rotation) : la
changer revient au cas « clé perdue ».

## Export et sauvegarde : la clé d'export

Un fichier qui sort de la plateforme (export de configuration avec secrets,
sauvegarde complète) ne porte ses secrets que **scellés par une clé d'export** :
une clé **générée à chaque téléchargement**, montrée une seule fois, redemandée à l'import.

```
export   : secrets ──► scellés par la CLÉ D'EXPORT ──► fichier
import   : fichier + même clé d'export ──► secrets ──► rechiffrés par la SECRETS_KEY d'arrivée
```

| | Clé d'export | `SECRETS_KEY` |
|---|---|---|
| Protège | UN fichier exporté | la base |
| Vit | générée à l'export, rangée dans votre gestionnaire de mots de passe, à part du fichier | dans l'environnement de l'API |
| Perdue | ce fichier ne rend plus ses secrets | l'API refuse de démarrer |
| Fuite avec le fichier | ce fichier seul est ouvert | toute la base serait ouverte |

La `SECRETS_KEY` n'est **jamais** mise dans un fichier exporté : c'est le point
de la séparation. Un fichier peut ainsi partir vers une plateforme qui a une
autre `SECRETS_KEY` (ou aucune).

- **Export de configuration** : seuls les secrets sont scellés (clés API et
  comptes n8n, jetons GitHub / Drive, mot de passe Kuma, clés IA), le reste
  du JSON reste lisible. Les jetons de heartbeat restent en clair : les
  workflows n8n les portent déjà dans leur URL.
- **Sauvegarde complète** : le fichier entier est scellé.
- **Clé** : générée par la console (`xxxxx-xxxxx-xxxxx-xxxxx`, environ 99
  bits), affichée une seule fois avec un bouton « Copier ». Le fichier ne part
  qu'une fois cochée « J'ai rangé cette clé en lieu sûr » : un fichier scellé
  dont personne n'a la clé ne rendrait plus jamais ses secrets. Elle n'est
  enregistrée nulle part, ni par la plateforme ni par le navigateur.
- **Pourquoi pas la `SECRETS_KEY` dans le fichier, même chiffrée** : elle n'y
  serait protégée que par la clé d'export. Fichier et clé d'export qui fuient
  ensemble ouvriraient alors toute la base et ses sauvegardes, et non plus ce
  seul fichier. Elle ne sert d'ailleurs à rien à l'import : la plateforme
  d'arrivée rechiffre avec la sienne.
- **Anciens fichiers** (d'avant la clé d'export, secrets en clair) : ils
  s'importent et se restaurent toujours, sans clé.
- Les deux téléchargements restent fermés par défaut (`CONFIG_EXPORT_ENABLED`).

Pour l'API : `POST /config-transfer/export {includeSecrets, exportKey}`
(`GET` = export sans secrets), `POST /config-transfer/import {…, exportKey}`,
`POST /config-transfer/backup` (formulaire, champ `exportKey`),
`POST /config-transfer/restore/upload` (en-tête `x-export-key`). Une clé
absente, trop courte ou fausse répond 400 avec la raison. Chiffrement :
scrypt (sel propre à chaque fichier) puis AES-256-GCM
(`apps/api/src/infra/secrets/export-key.ts`, `export-file-cipher.ts`). L'API
accepte toute clé de 12 caractères au moins : la génération est le choix de la
console, un script peut fournir la sienne.

## Pour qui maintient le code

Le chiffrement est posé une fois, sur le client Prisma injecté partout
(`apps/api/src/infra/secrets/`) : `Instance.apiKey` et `Instance.n8nPassword`
sont chiffrés à l'écriture et déchiffrés à la lecture, lectures imbriquées et
transactions comprises. Aucun service n'a à s'en occuper ; le SQL brut, lui,
voit le chiffré. AES-256-GCM, format `enc:v1:<iv>.<tag>.<chiffré>`. Les autres
secrets en base (clé IA, mot de passe Kuma, jetons d'export, webhooks d'alerte)
ne sont pas encore couverts : les ajouter tient en une ligne de plus dans
`secret-encryption.ts`, plus leur cas dans la préparation au démarrage.
