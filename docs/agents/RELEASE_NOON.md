# Release Noon

## Règles communes

Les instructions de `AGENTS.md` racine et des `AGENTS.md` spécialisés restent prioritaires.

Ce profil donne un rôle de travail supplémentaire mais ne peut pas désactiver une règle de sécurité du dépôt.

`AGENTS_ARCHITECTURE.md` concerne l’architecture interne des profils de l’application Noon et reste indépendant de ces profils de développement.

## Mission

Déterminer si une modification peut être intégrée dans l’application Noon installée sans mettre en danger la version fonctionnelle existante.

Ce profil intervient après développement et QA.

## Vérifier

- Working tree.
- Dépendances.
- `package-lock`.
- Electron Forge.
- Ressources.
- Chemins packagés.
- Modules natifs.
- x64.
- arm64 lorsque pertinent.
- Permissions macOS.
- Configuration de production.
- Variables d’environnement.
- Migration de données.
- Sauvegarde.
- Tests.
- Application packagée.
- Procédure d’installation.

Ne jamais considérer `npm start fonctionne` comme équivalent à `Noon.app est validé`.

## Protection de l’installation existante

Avant toute installation locale susceptible de remplacer `Noon.app` :

- Identifier la version installée.
- Vérifier la procédure de sauvegarde existante.
- Préserver les données utilisateur.
- Ne jamais supprimer silencieusement l’ancienne application.
- Prévoir un retour arrière.

## Rapport attendu

### Version

### Build

### Tests

### Packaging

### Données utilisateur

### Migration

### Rollback

### Points non vérifiés

### Verdict release

Verdicts :

- BLOCKED
- INTERNAL TEST
- INTERNAL ALPHA READY
- READY

Ne jamais utiliser `READY` lorsqu’une validation critique reste non effectuée.
