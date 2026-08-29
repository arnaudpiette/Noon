# Configuration runtime et feature flags

## Sources auditées

Noon utilisait des variables d'environnement pour les fournisseurs, chemins, budgets et délais ; `localStorage` pour les préférences renderer ; JSON pour plusieurs stores locaux ; SQLite pour les moteurs structurés ; et des constantes de build pour les limites et modèles. Cette étape ne migre que les paramètres réellement opérationnels nécessaires au premier rollout. Les secrets restent dans `safeStorage`/le trousseau et les Hard Rules restent hors configuration.

## Architecture

- `ConfigRegistry` définit types, valeurs par défaut, limites, scopes, exposition publique et politique de redémarrage.
- `RuntimeConfigService` applique `BUILD → MACHINE → USER → WORKSPACE → SESSION → TEST`, conserve la provenance, produit des snapshots et écrit atomiquement `current` et `last-known-good`.
- `FeatureFlagRegistry` décrit mode, lifecycle, dépendances, incompatibilités, chemins legacy/moderne et compatibilité de rollback.
- `FeatureFlagService` évalue les flags de façon déterministe, applique allowlists/cohortes, kill switch et promotion gates.
- `FeatureRolloutService` garantit qu'un seul chemin possède l'autorité. Un shadow mutateur doit être explicitement déclaré dry-run sûr.
- `ShadowComparator` compare uniquement codes, identifiants et empreintes, jamais les contenus privés.

## Premier rollout

`router.policy.v2` est déclaré `ON`, car cette politique était déjà le comportement actif avant l'introduction des flags. Son passage explicite en `SHADOW` utilise le routeur historique comme résultat actif et calcule la politique v2 localement, sans second appel modèle. Search, Intent et Transactional Files restent `OFF` tant que leurs call sites ne sont pas reliés au service de rollout. Aucun connecteur ni effet de bord n'est doublé.

## Récupération et rollback

Une configuration invalide n'est jamais activée. Les écritures utilisent un fichier temporaire puis un renommage atomique. Au démarrage, une configuration corrompue déclenche la dernière version valide, sinon les defaults sûrs. Un kill switch force le chemin legacy lorsqu'il existe. Un flag ne restaure jamais un schéma de base incompatible : les migrations doivent suivre expand/contract.

## Sécurité

Aucun flag ne désactive Hard Rules, Approval Engine, `local_only`, les racines autorisées ou l'Operational Security Policy. Les endpoints de diagnostic sont locaux, en lecture seule et expurgés. Les snapshots excluent toutes les clés sensibles.
