# Noon — Registre des tâches

## Rôle

Ce fichier répertorie les tâches de développement documentées dans `docs/tasks/`.

Il permet de connaître rapidement :

- les tâches actives ;
- les tâches bloquées ;
- les tâches prêtes pour QA ;
- les tâches prêtes pour Release ;
- les tâches terminées.

Ce fichier est un index.

Les détails techniques restent dans chaque fiche de tâche.

---

## Statuts autorisés

Utiliser uniquement :

- À analyser
- Analyse en cours
- Bloqué
- Prêt pour implémentation
- Implémentation en cours
- Prêt pour QA
- QA en cours
- Correction requise
- Prêt pour Release
- Release en cours
- Prêt pour installation
- Terminé
- Abandonné

---

## Format

Utiliser un tableau :

| Tâche | Fichier | Risque | Statut | Dernière mise à jour | Prochaine action |
| --- | --- | --- | --- | --- | --- |

Chaque tâche doit avoir exactement une ligne.

Le champ `Fichier` doit pointer vers sa fiche Markdown réelle.

Ne jamais créer une entrée pour une tâche inexistante.

---

## Tâches actives

Aucune fiche de tâche active n’est actuellement présente dans `docs/tasks/`.

---

## Tâches terminées

Aucune fiche de tâche terminée n’est actuellement présente dans `docs/tasks/`.

Ne pas supprimer les fiches lorsqu’elles seront ajoutées.

---

## Règle de synchronisation

Lorsqu’une fiche change significativement :

mettre à jour également son entrée dans `INDEX.md`.

En particulier si changent :

- statut ;
- niveau de risque ;
- prochaine action ;
- blocage ;
- fin de tâche.

La fiche détaillée reste prioritaire sur l’index en cas de contradiction.

---

## Initialisation

L’index est initialisé à partir des fiches réellement présentes dans `docs/tasks/`.

`README.md`, `INDEX.md` et `ACTIVE_TASK.md` décrivent le suivi des tâches et ne sont pas des fiches de développement.

N’inventer aucun état de tâche absent du dépôt.
