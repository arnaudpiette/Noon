# Ambient Context Engine

Le contexte ambiant de Noon est un état de travail **éphémère, explicite et non autoritaire**. Il n'est ni un système de surveillance, ni une mémoire longue durée.

## Déploiement initial

- `context.ambient` : `SHADOW` ;
- `context.explicitShare` : `LIMITED` ;
- `context.activeApp` : `SHADOW` (nom/bundle de l'application seulement) ;
- `context.vscode`, `context.figma` et `context.screenCapture` : `OFF`.

Le mode d'exécution reste `OFF` tant que l'utilisateur ne démarre pas une session. Une session affiche `visibleIndicator: true`, possède une échéance et sa fermeture supprime immédiatement tous ses signaux. Aucun historique n'est enregistré et aucun signal n'est envoyé au `MemoryEngine`.

## Frontières de confidentialité

Noon ne collecte pas passivement les frappes, le presse-papiers, l'écran, les titres de fenêtres, les e-mails, l'historique Web ou le contenu du terminal. Aucune permission Accessibilité ou Enregistrement de l'écran n'est demandée. Une référence `local_only` ou `restricted` est filtrée avant tout contexte distant.

L'application active est un indice faible : elle ne change jamais le Focus, le mode, un statut de tâche ou une autorisation d'écriture. L'intention explicite de l'utilisateur prime toujours.

## Contrats

- `AmbientContextPolicy` décide collecte, rétention, injection distante et influence proactive.
- `ContextSignalRegistry` conserve uniquement l'instant courant et applique le TTL.
- `AmbientContextEngine` gère démarrage, arrêt, snapshot, vue utilisateur et health.
- Les adaptateurs VS Code/Figma ne transmettent que des identifiants structurés après activation et permission explicites.
- Les références de fichiers sont résolues par `realpath`, bornées aux racines autorisées et accompagnées d'une précondition taille/mtime. Elles ne valent jamais autorisation d'écriture.

## Limite UI actuelle

Le moteur expose les contrats `start`, `stop`, `currentView` et `visibleIndicator`. Leur branchement dans une vue dédiée de l'interface Electron reste volontairement derrière le feature flag de déploiement ; aucune collecte ne démarre en son absence.
