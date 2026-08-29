# Daily Brief Engine

## Architecture après unification

À 07:00, heure de Paris, Electron vérifie `/daily-brief`. Si aucun résultat n’existe pour la date locale, il appelle une seule fois `/daily-brief/generate`. Le même contrôle assure le rattrapage au réveil et empêche une seconde génération dans la journée.

Le moteur central se trouve dans `services/daily-brief/daily-brief-engine.js`. Il collecte les sources via `MorningBriefService`, demande au Context Builder un contexte `daily_brief` minimal, classe toutes les actions avec le Priority Engine, conserve les propositions de créneaux, puis effectue une seule composition distante incluant éventuellement une section créative.

## Avant / après

Avant : deux générations successives, une Terra avec recherche Web pour le créatif puis une Luna pour le personnel ; deux stockages et deux routes de lecture.

Après : une collecte logique, un classement, un appel Terra maximum, un résultat utilisateur et un stockage canonique (`personal-brief.json`). Les anciennes routes `/brief` et `/personal-brief` restent des adaptateurs vers ce résultat pendant la période de compatibilité. `creative-brief.json` reste en lecture seule pour l’historique anti-répétition ; il n’est pas supprimé automatiquement.

## Sources et sécurité

Calendar, Gmail, Reminders et Notes sont collectés en parallèle par leurs connecteurs existants. Projects et mémoire passent par leurs services centraux. Une source secondaire indisponible est signalée dans `sourceStatus` sans interrompre le brief. Aucun contenu brut n’est écrit dans les traces.

Le Context Builder applique les Hard Rules et les politiques mémoire. Il ne transmet pas toute la mémoire. Les contenus `local_only`, les consentements et les confirmations restent filtrés par MemoryEngine.

## Priorité et planning

Le Priority Engine est l’unique source du score. Le moteur de créneaux conserve la pause protégée de 12:30 à 13:30. Les événements préparés utilisent Myrtille, portent une signature Noon et restent des propositions avec validation ; aucune écriture Calendar silencieuse n’est ajoutée par cette étape.

Les brouillons Gmail peuvent être préparés selon les réglages existants. Aucun e-mail n’est envoyé automatiquement.

## Idempotence et mode dégradé

L’identifiant logique est `brief_YYYY-MM-DD`. Les appels simultanés partagent la même promesse et un brief prêt est réutilisé jusqu’au lendemain, sauf actualisation manuelle explicite. Si la composition distante échoue, un rendu local minimal présente agenda, priorités et créneaux disponibles.

## Observabilité

Le résultat contient les durées de collecte, extraction, priorité, planification, génération et total, ainsi que les compteurs de sources, actions, créneaux, créations et appels modèle. Les traces utilisent l’identifiant du brief et des compteurs, jamais les titres ou contenus privés.
