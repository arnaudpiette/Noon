# Hard Rules Registry

Le registre canonique se trouve dans
`services/rules/hard-rules-registry.js`. Une Hard Rule décrit ce que Noon doit
ou ne doit pas faire. Elle n'est ni une préférence, ni un souvenir, ni une
permission accordée pour une action particulière.

## Hiérarchie

Une règle de niveau supérieur gagne toujours sur un niveau inférieur :

1. `security`
2. `privacy`
3. `permissions`
4. `system`
5. `user_permanent`
6. `mode`
7. `project`
8. `preference`

Une préférence comme « ne demande pas de confirmation » ne peut donc jamais
neutraliser une confirmation destructive de sécurité.

## Structure

Chaque règle possède un ID stable, une catégorie, une hiérarchie, des scopes,
une valeur structurée facultative, un type d'enforcement et la liste des
composants responsables de son application.

Les valeurs d'`enforcement` sont :

- `llm` : instruction contextuelle, sans prétention de barrière technique ;
- `code` : contrôle déterministe côté application ;
- `both` : instruction et contrôle côté code.

## Permissions

Le registre ne remplace pas `skills/permissions.js`. Il traduit l'échelle
existante sans créer un second système :

| Niveau technique | Capacité fonctionnelle |
| --- | --- |
| `read` | `READ` |
| `draft` | `PREPARE` |
| `write` | `WRITE` |
| `external` | `EXECUTE` |
| `destructive` | `EXECUTE` avec confirmation renforcée |

## Compatibilité legacy

Les anciennes lignes de règles restent présentes dans `memory_items` et
`private_hard_rules` afin de ne perdre aucune donnée et de préserver les écrans
existants. Leurs définitions proviennent maintenant du registre. `MemoryEngine`
ne renvoie plus comme souvenirs les contraintes opérationnelles possédant un
équivalent canonique.

Aucune donnée n'est migrée ni supprimée à cette étape.
