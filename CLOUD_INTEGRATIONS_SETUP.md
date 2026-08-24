# Connexions cloud de Noon

Noon démarre avec `DRY_RUN_EXTERNAL_WRITES=true`. Les lectures peuvent être testées après connexion, mais les écritures restent simulées.

## Google Workspace

1. Dans Google Cloud Console, créer ou sélectionner un projet privé.
2. Activer Gmail API, Calendar API, Drive API et People API.
3. Configurer l’écran de consentement OAuth pour votre compte de test.
4. Créer un client OAuth local et enregistrer `http://127.0.0.1:3000/integrations/google/callback`.
5. Placer l’identifiant et le secret dans `.env`, jamais dans une conversation ou Git.
6. Noon demande séparément les scopes de lecture et d’écriture nécessaires. Gmail `compose` permet les brouillons et l’envoi : Noon bloque néanmoins l’envoi sans autorisation ponctuelle.

## GitHub

Utiliser d’abord `gh auth login` puis `gh auth status`. Ne jamais afficher `gh auth token`. Si un token est indispensable, utiliser un token finement limité au dépôt et aux permissions nécessaires. Staging, commit, push et pull request exigent des confirmations séparées. Force-push et réécriture d’historique restent impossibles.

## Figma

Créer une application OAuth Figma, déclarer le callback local, puis renseigner les variables `FIGMA_*` dans `.env`. La première version utilise `file_content:read`, `file_metadata:read` et, si nécessaire, `file_comments:read`. Les URL sont limitées à HTTPS et aux domaines Figma.

## Stockage

Dans Electron, les tokens sont chiffrés avec `safeStorage` et le Trousseau macOS. En mode serveur Node seul, ils restent uniquement en mémoire et la persistance est signalée comme indisponible.
