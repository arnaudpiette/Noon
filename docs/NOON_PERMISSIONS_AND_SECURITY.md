# Permissions et sécurité de Noon

## Modèle de confiance

Le renderer est non fiable : `nodeIntegration` est désactivé, `contextIsolation` et le sandbox sont actifs. Le preload expose uniquement des méthodes nommées. Les secrets restent dans le processus principal et sont chiffrés avec `safeStorage`.

## Fichiers locaux

- Accès limité aux racines configurées et projets Focus effectivement résolus.
- Normalisation et résolution réelle des chemins avant accès.
- Refus des traversées `../`, liens symboliques sortants, secrets et répertoires exclus.
- Lecture seule pour les outils du modèle et Codex.
- Aucun scan complet du disque et aucun chemin proposé par le modèle n’est implicitement fiable.

La future création de livrables devra cibler un dossier explicitement autorisé en écriture, employer un fichier temporaire puis un renommage atomique. Modifier, déplacer, écraser ou supprimer exige toujours un aperçu et une confirmation.

## Réseau et intégrations

Les connecteurs ne lisent des données qu’après connexion. Toute écriture distante utilise une autorisation ponctuelle liée au contenu exact. Gmail est actuellement lecture seule. Une permission refusée n’est jamais contournée.

## Conversations et confidentialité

Les conversations, résumés, souvenirs et index restent dans le répertoire de données local de Noon, ignoré par Git et exclu du paquet. Le stockage brut n’est pas tronqué ; seule la fenêtre de contexte envoyée à l’API est bornée. Supprimer une conversation efface sa mémoire et son résumé locaux.

## Microphone

La permission est demandée au moment utile. Le réveil vocal est facultatif et local avant activation. Les pistes et contextes audio sont fermés à la fin de la session. Le microphone ne démarre pas silencieusement au lancement.
