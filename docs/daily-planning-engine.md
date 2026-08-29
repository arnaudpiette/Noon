# Daily Planning Engine

Le moteur de planification quotidienne place les actions déjà classées sans créer un second score de priorité et sans recalculer lui-même les disponibilités.

## Autorités

- `PriorityEngine` classe les actions qui n’ont pas encore de score canonique.
- `TimeSlotService` reste l’unique autorité de disponibilité.
- `HardRulesRegistry` fournit notamment la pause protégée.
- `ApprovalEngine` signe le batch exact avant toute écriture Calendar.
- Le connecteur Calendar conserve la signature privée Noon et la couleur Myrtille.

## Résultat

Chaque plan versionné contient les événements fixes, blocs préservés, propositions, actions non planifiées, avertissements, capacité, buffers et explications. Son empreinte ne contient pas les titres privés.

## Replanification

La replanification est explicitement déclenchée et conserve le passé, le travail terminé ou en cours, les déplacements manuels et les blocs futurs non touchés. Un nouvel événement ne déplace que les blocs en conflit. Aucune boucle de polling n’est ajoutée.

## Écriture Calendar

Une proposition n’est jamais une création. La preview d’approbation contient le batch exact, sa version et les empreintes de contraintes. Si le plan change, l’ancienne version doit être rejetée comme `plan_stale`. L’écriture réelle reste du ressort Orchestrator → Skill Registry → Approval Engine → Calendar.

## Données locales

Les plans sont stockés dans `daily-plans.json`, hors Git, avec une rétention maximale de 31 journées. Les journaux ne reçoivent que compteurs, durées, identifiants et reason codes.
