# Noon Orchestrator

Le moteur central se trouve dans
`services/orchestration/noon-orchestrator.js`. Le serveur HTTP valide et
normalise les requêtes, puis la façade `askAI()` prépare uniquement les
instructions et les handlers métier nécessaires. L'Orchestrator coordonne le
reste.

## Cycle d'exécution

1. création d'un `executionId` aléatoire sans donnée personnelle ;
2. construction du contexte par le Context Builder ;
3. sélection du modèle par le routeur existant ;
4. appel Responses, en streaming ou non ;
5. exécution des function calls par le Skill Registry ;
6. réinjection des résultats ;
7. fallbacks de compatibilité et de modèles ;
8. réponse structurée et métriques.

L'Orchestrator ne lit directement aucune mémoire et ne contient aucune logique
de fichier, Gmail, Calendar, Codex ou génération. Ces responsabilités restent
dans les services et handlers existants.

## Approbations

Lorsqu'un Skill répond `CONFIRMATION_REQUIRED`, l'exécution est mise en mémoire
volatile et l'Approval Manager crée une autorisation liée au nom de l'outil, à
sa cible et au hash exact de ses arguments.

Le client peut appeler `POST /orchestrator/approval` avec `executionId`,
`approvalId` et `approved`. Une acceptation consomme l'autorisation une seule
fois puis reprend l'action exacte. Un refus réinjecte un résultat de refus dans
la conversation sans exécuter l'outil. Une autorisation destinée à une autre
cible ou à un autre contenu est rejetée.

## Streaming

Les événements `response.output_text.delta` sont transmis au callback SSE
existant. L'Orchestrator mesure le délai jusqu'au premier token et attend la
réponse finale avant de fermer le workflow.

## Fallbacks

La politique de routage n'est pas modifiée. `selectModelRoute()` et
`modelFallbacks()` restent les sources de vérité pour Luna, Terra et Sol.
Les fallbacks de compaction et `tool_search` sont également conservés.

## Observabilité

Les événements `orchestrator.*` enregistrent seulement :

- `executionId` ;
- canal ;
- modèle sélectionné ;
- nombre de tours outils et de fallbacks ;
- temps de contexte, modèle, outils, premier token et total ;
- catégories d'erreur.

La question, les prompts, les arguments d'outils et les contenus privés ne sont
jamais écrits dans ces traces.

## Migration progressive

Le chat texte, y compris son streaming et ses Skills, utilise l'Orchestrator.
Restent legacy : Live Voice, briefs créatif et personnel, analyses background
et routes métier spécialisées. Leur migration n'appartient pas à cette étape.
