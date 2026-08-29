# Update Recovery Engine

Noon sépare désormais mise à jour applicative, migration de schéma, migration de données, backup et restauration. Le moteur ne télécharge ni n'installe aucune mise à jour.

## Données durables

| Store | Classe | Nature | Backup |
| --- | --- | --- | --- |
| SQLite personnel | CRITICAL | canonique, sensible, mémoire privée chiffrée par payload | oui |
| Conversations et index | CRITICAL | canoniques, sensibles | oui |
| Configuration runtime | CRITICAL | canonique, sans secret brut | oui |
| Résumés et registre projets | IMPORTANT | local | oui |
| Métadonnées artefacts, workspaces, approvals et execution journal | CRITICAL/IMPORTANT | inclus dans SQLite | oui |
| Index de recherche | REBUILDABLE | dérivé | non requis |
| Previews et caches | EPHEMERAL | jetable | non |
| Tokens OAuth/OpenAI | sécurisé | safeStorage/référence | jamais déchiffrés dans le backup |

## Boot et recovery

Le diagnostic `/api/lifecycle/status` inspecte la version attendue, le journal incomplet, les backups valides, la configuration et les exécutions actives. L'intégration initiale reste en diagnostic/dry-run : le bootstrap existant reste autoritaire et aucune migration réelle n'est doublée.

SQLite utilise WAL. Le backup de production prévu passe par `VACUUM INTO`, qui construit une image cohérente, puis le manifeste et les empreintes sont validés. Les JSON sont copiés avec permissions restreintes. Les mémoires privées restent sous forme chiffrée ; ce backup local dépend toujours du mécanisme safeStorage de l'installation courante et n'est pas présenté comme export portable.

Une restauration manuelle exige une approbation exacte, sauvegarde d'abord l'état courant, restaure en maintenance puis valide. Un feature rollback n'est équivalent à une restauration que si le schéma reste compatible. Les migrations futures doivent suivre expand/migrate/switch/verify/contract.
