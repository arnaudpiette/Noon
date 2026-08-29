# Migration contrôlée de la mémoire legacy

La mémoire privée chiffrée est la cible canonique. La migration suit l'ordre
`sauvegarde → dry-run → migration → comparaison → validation`. Elle ne supprime
jamais les sources historiques.

## Sources classées

- `long-term-memory.json` : souvenirs historiques, importés en `pending_review`
  et `local_only` sous le profil propriétaire ;
- `memory_items` : souvenirs structurés encore en clair, avec conservation du
  statut lorsque cela est sûr et déclassement prudent en cas d'ambiguïté ;
- conversations et résumés : conservés comme contexte de session, non migrés ;
- projets et journaux : conservés dans leur registre spécialisé ;
- préférences de planning : conservées comme configuration déterministe ;
- Hard Rules : registre central canonique, doublons legacy ignorés ;
- personnalité et prompts : non considérés comme souvenirs personnels.

## Garanties

- profils familiaux séparés, sans attribution déduite du texte ;
- santé, droit, finance, adresse, école et profils protégés restent à valider ;
- contenu chiffré par AES-256-GCM, clé protégée par `safeStorage` dans Electron ;
- provenance technique, empreinte et identifiant de migration sans texte privé ;
- migration idempotente par source et rollback limité aux lignes créées ;
- sauvegarde avec manifeste et sommes SHA-256 avant écriture ;
- aucun message de conversation n'est promu automatiquement en mémoire durable.

Les métriques de lecture parallèle (`canonicalReadHits`, `legacyReadHits`,
`shadowReadDifferences`) restent actives dans `MemoryEngine` jusqu'à la future
suppression contrôlée des anciennes lectures.
