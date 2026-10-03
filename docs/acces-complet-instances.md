# Accès complet aux instances

Une instance n8n reliée à Ops peut porter le compte **propriétaire** de n8n
(e-mail + mot de passe). Sans lui, Ops ne connaît ni la version de n8n ni les
nœuds réellement installés sur cette instance, et les actions d'administration
restent fermées.

```
compte propriétaire absent                 compte propriétaire renseigné
──────────────────────────                 ─────────────────────────────
clé API seule → API publique /api/v1       + session n8n → version, nœuds, admin
contrôles sur un catalogue mutualisé       contrôles sur TA version et TES nœuds
```

## Ce que la console demande

Quand le module d'administration est actif, chaque enregistrement d'une instance
n8n sans compte propriétaire ouvre la fenêtre **« Accès complet à cette
instance »** :

| Bouton | Effet |
|---|---|
| **Enregistrer avec l'accès complet** | la saisie du formulaire part avec l'e-mail et le mot de passe |
| **Continuer sans** | la saisie part telle quelle ; rien n'est perdu |
| Échap, croix | comme « Continuer sans » |

Une instance déjà enregistrée sans compte garde un rappel : une pastille
**« accès partiel »** dans la liste, un bandeau sur sa fiche avec
**« Renseigner »** (la même fenêtre) et **« Ne plus demander pour cette
instance »**.

Une instance Make, ou une instance qui a déjà son compte, ne déclenche rien.
Module d'administration désactivé : ni fenêtre ni rappel.

## Ne plus être relancé

Cochez **« Ne plus me demander pour cette instance »** dans la fenêtre, ou
cliquez **« Ne plus demander pour cette instance »** sur la fiche. Le refus est
écrit **sur l'instance** (date + personne), pas dans le navigateur : il tient
après reconnexion et depuis n'importe quel poste. Il se lève depuis la fiche
par **« Redemander l'accès complet »**.

## Où va le mot de passe

Il est conservé côté serveur avec les autres secrets de l'instance (clé API),
**chiffré au repos** dès que `SECRETS_KEY` est posée (voir
[chiffrement-secrets.md](chiffrement-secrets.md)), et n'est **jamais réaffiché
ni renvoyé à l'écran** : la console ne voit que
l'e-mail et un drapeau « compte renseigné ». Le compte sert uniquement à Ops,
côté serveur (session n8n pour lire `/types/*.json`, voir
[ARCHITECTURE.md](../ARCHITECTURE.md)) ; aucun usage depuis le navigateur.

Pour l'API : `POST /instances` et `PATCH /instances/:id` acceptent
`fullAccessDismiss: true | false` (poser / lever le refus) ; l'auteur est lu
dans l'en-tête `x-user-email` posé par le proxy de la console. Les réponses
exposent `hasN8nLogin`, `fullAccessDismissedAt` et `fullAccessDismissedBy`,
jamais `n8nPassword`.
