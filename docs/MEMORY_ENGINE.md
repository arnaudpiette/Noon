# MemoryEngine

`services/memory/memory-engine.js` est la façade de lecture commune des
mémoires de Noon. Elle ne crée aucun stockage, ne déplace aucune donnée et ne
modifie pas le cycle de vie des sources existantes.

## Sources

- `private_memory` : service privé chiffré et son Context Builder ;
- `structured_memory` : dépôt `memory_items` ;
- `legacy_memory` : mémoire historique JSON ;
- `conversation_memory` : fenêtre conversationnelle fournie par le serveur ;
- `project_memory` : projets structurés fournis par le dépôt existant.

Chaque source est injectée dans la façade. Une panne isolée produit seulement
un code technique dans `metadata.errors` et n'empêche pas les autres sources
de répondre.

## Confidentialité

La façade ne lit jamais les colonnes chiffrées. Elle passe par
`private-memory-service` et conserve les décisions du Context Builder.
`local_only` reste disponible dans `localOnlyContext`, mais porte toujours
`allowedForRemoteModel: false`. `confirm_each_use`, les consentements, les
profils désactivés, les statuts non confirmés et les expirations sont filtrés
avant la construction de `remoteContext`.

Seul `remoteContext` peut être transformé en instruction pour Responses.

## Déduplication à la lecture

Aucune entrée n'est supprimée. Une empreinte normalisée est calculée à partir
du contenu textuel utile, sans tenir compte de la casse, des accents ou de la
ponctuation. Pour une valeur structurée, les valeurs scalaires sont utilisées
plutôt que les noms de propriétés JSON.

Si deux représentations ont la même empreinte, la priorité est :

1. mémoire privée confirmée ;
2. mémoire structurée ;
3. mémoire projet ;
4. mémoire historique ;
5. mémoire conversationnelle.

À priorité égale, la pertinence puis la date de mise à jour départagent les
éléments. Une entrée privée `local_only` prioritaire empêche volontairement une
copie historique équivalente de réintroduire le même fait dans le contexte
distant.

## Budget et observabilité

`maxItems` et `maxCharacters` bornent la sélection. Le résultat conserve la
provenance, les IDs, le statut, la confiance, la politique API et les indicateurs
local/distant. Les logs DEBUG contiennent uniquement des compteurs, durées,
sources et codes d'erreur ; jamais le contenu des souvenirs.
