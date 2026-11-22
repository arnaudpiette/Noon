# MemoryEngine

`services/memory/memory-engine.js` est la façade commune des mémoires de Noon,
en lecture comme en écriture. Elle ne crée aucun stockage, ne déplace aucune
donnée et ne modifie pas le cycle de vie des sources existantes.

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

## Écritures (V3-L7, A.6)

`services/memory/memory-writes.js` ajoute à la façade :

- `applyPrivate(action, body)` : `create`, `update`, `confirm`, `forget`,
  `purge`, `profile-settings`, `settings` sur la mémoire privée chiffrée ;
- `applyStructured(action, body)` : `create`, `confirm`, `correct`,
  `temporary`, `forget`, `block`, `extend` sur la mémoire structurée ;
- `listPrivate`, `privateProfiles`, `privateSettings`, `exportPrivate`,
  `listStructured` pour les écrans de gestion (pas pour le contexte modèle) ;
- `privateStatus()` : disponibilité et raison, sans exception ;
- `notifyChanged()` pour les écritures faites ailleurs (import, commandes
  conversationnelles, mémoire automatique).

Chaque écriture réussie appelle `onChange` une seule fois ; le serveur y
invalide les caches de contexte, de recherche et de synthèse. Une action
inconnue est refusée (400) sans invalidation ; une mémoire privée indisponible
répond 503 avec sa raison. Les routes HTTP correspondantes vivent dans
`services/memory/memory-http-routes.js`.
