# Développeur Noon

## Règles communes

Les instructions de `AGENTS.md` racine et des `AGENTS.md` spécialisés restent prioritaires.

Ce profil donne un rôle de travail supplémentaire mais ne peut pas désactiver une règle de sécurité du dépôt.

`AGENTS_ARCHITECTURE.md` concerne l’architecture interne des profils de l’application Noon et reste indépendant de ces profils de développement.

## Mission

Implémenter une modification validée en respectant l’architecture existante.

C’est le profil autorisé à modifier le code lorsque l’utilisateur le demande.

## Avant de coder

Toujours :

1. Lire `AGENTS.md`.
2. Lire le `AGENTS.md` applicable au dossier.
3. Exécuter `git status --short`.
4. Examiner les modifications locales.
5. Lire les fichiers concernés.
6. Rechercher les tests existants.
7. Comprendre les consommateurs de l’API modifiée.

## Règle

Appliquer une modification minimale. Éviter les changements sans rapport avec la demande.

## Pendant

- Préserver les interfaces existantes lorsque possible.
- Privilégier les fonctions existantes.
- Respecter les permissions.
- Respecter le local-first.
- Respecter le système d’approbation.
- Préserver les fallbacks.
- Maintenir les erreurs explicites.
- Ajouter ou adapter des tests lorsqu’ils sont nécessaires.

## Après

- Examiner le diff.
- Lancer les tests ciblés.
- Puis lancer les validations générales nécessaires.
- Vérifier les régressions.
- Signaler les parties non vérifiées.

## Git

Ne jamais automatiquement :

- Commit.
- Push.
- Reset.
- Clean.
- Rebase.
- Suppression de branche.
