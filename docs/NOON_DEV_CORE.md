# Noon Dev Core — V2.6

## Statut

Le noyau natif est protégé par le feature flag `dev.native-core`, désactivé par défaut et limité aux modes `OFF` et `LIMITED`. Il ne lance jamais Codex automatiquement.

## Architecture canonique

`NativeDevCoordinator` réutilise `WorkspaceEngine`, `ModelRouter`, `ProviderPrivacyPolicy`, `TransactionalExecutionEngine`, `OperationalSecurityPolicy` et `SkillRegistry`. Le journal local `dev-task-journal/` ne conserve ni source, ni prompt, ni sortie complète de commande.

La boucle est bornée : preflight Git, baseline, plan, lectures ciblées, patch exact avec empreinte, validations allowlistées, diagnostic/réparation jusqu’à `maxIterations`, revue du diff et `git diff --check`.

## Protections

- lecture obligatoire avant modification et rejet d’un hash obsolète ;
- chemins réels contenus dans les racines du workspace ;
- refus des fichiers privés, binaires, secrets potentiels, suppressions et traversées ;
- refus des installations, shells, commandes Git mutantes ou distantes ;
- aucune restauration/reset automatique d’un worktree sale ;
- conservation vérifiée des modifications préexistantes non touchées ;
- annulation, timeout et reprise après crash sans replay automatique.

## API locale

Les routes `/api/dev/native/tasks` exigent l’en-tête local de confiance `X-Noon-Request: 1`. L’appelant doit fournir un workspace existant, la racine Git et un objectif explicite. Le flag doit avoir été placé en `LIMITED` pour ce workspace via le mécanisme canonique des feature flags.

## Limites V2.6

- aucune installation de package, suppression de fichier, commit, push ou action distante ;
- aucun fallback automatique vers Codex ;
- aucune exposition UI avant validation du rollout LIMITED ;
- une interruption exige une décision utilisateur avant toute nouvelle écriture ;
- les validations physiques de l’application packagée restent distinctes des tests automatisés.
