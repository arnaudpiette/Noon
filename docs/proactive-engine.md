# Moteur proactif de Noon

Le moteur proactif est l’autorité unique qui transforme des événements locaux autorisés en recommandations. Il n’exécute jamais une action externe et n’appelle aucun modèle pendant son cycle déterministe.

## Flux

1. Les adaptateurs normalisent Calendar, Reminders, Notes, Gmail, Projets, Mémoire, Daily Brief et les signaux locaux.
2. Le `PriorityEngine` central calcule le score et ses raisons.
3. La politique d’interruption choisit `IGNORE`, `STORE_FOR_BRIEF`, `SURFACE_WHEN_RELEVANT`, `SUGGEST`, `NOTIFY` ou `URGENT_NOTIFY`.
4. La déduplication applique cooldown, évolution matérielle, expiration et réponse utilisateur.
5. Le Daily Brief consomme les mêmes recommandations. Il ne possède plus un second classement proactif.
6. Toute proposition d’écriture ou d’action externe passe ensuite par l’`ApprovalEngine` existant.

## Vie privée

Les adaptateurs ne conservent ni corps d’e-mail, ni contenu brut de note, ni payload de mémoire privée. Une mémoire `local_only` est refusée dès qu’un contexte distant est indiqué. Les audits enregistrent uniquement des comptes, états et identifiants techniques.

## Déclenchement

Le moteur est événementiel : chargement explicite du panneau de recommandations, préparation du Daily Brief ou arrivée d’un signal autorisé. Aucun polling réseau agressif n’est ajouté. La pause protégée de 12 h 30 à 13 h 30 et le mode Focus repoussent les interruptions non urgentes.

## Configuration

`NOON_MAX_PROACTIVE_NOTIFICATIONS` fixe le budget quotidien des notifications non urgentes (3 par défaut). Les alertes réellement urgentes ne consomment pas ce quota.
