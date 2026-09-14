# Noon — Suivi des tâches de développement

## Rôle

Chaque évolution importante de Noon peut disposer d’une fiche Markdown dans ce dossier.

Ces fiches sont basées sur :

`docs/agents/TASK_TEMPLATE.md`

Elles constituent l’historique technique de la tâche.

Elles ne remplacent pas Git.

Elles complètent Git en enregistrant notamment :

- l’objectif ;
- le niveau de risque ;
- l’analyse d’architecture ;
- les décisions ;
- les risques ;
- les fichiers concernés ;
- les tests exécutés ;
- les validations ;
- les éléments restant à vérifier.

---

# Convention de nommage

Utiliser :

`YYYY-MM-DD-nom-court-de-la-tache.md`

Exemples :

`2026-09-15-google-oauth-fix.md`

`2026-09-20-memory-migration.md`

Utiliser :

- minuscules ;
- tirets ;
- aucun espace ;
- aucun accent dans le nom du fichier.

---

# Création d’une nouvelle tâche

Pour une tâche importante :

1. copier la structure de `TASK_TEMPLATE.md` ;
2. créer une fiche dans `docs/tasks/` ;
3. conserver le même fichier pendant toute la durée de la tâche ;
4. mettre à jour son état à chaque étape importante.

Ne pas créer plusieurs fiches pour la même tâche simplement parce qu’un autre outil ou une autre conversation la reprend.

---

# Reprise d’une tâche

Avant de reprendre une tâche existante :

1. lire `AGENTS.md` ;
2. lire les `AGENTS.md` spécialisés concernés ;
3. lire `ORCHESTRATEUR_NOON_DEV.md` ;
4. lire la fiche de tâche ;
5. exécuter `git status --short` ;
6. comparer l’état Git actuel avec l’état documenté dans la fiche ;
7. vérifier que la fiche n’est pas dépassée par le code actuel.

Ensuite seulement, reprendre le travail.

---

# Source de vérité

Ordre de priorité :

1. working tree local actuel ;
2. code actuel ;
3. tests actuels ;
4. fiche de tâche ;
5. documentation ;
6. historique Git distant.

Une fiche de tâche peut devenir obsolète.

Ne jamais modifier le code pour le faire correspondre artificiellement à une ancienne fiche.

Mettre plutôt la fiche à jour.

---

# Statuts

Chaque fiche doit utiliser l’un des statuts suivants :

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

---

# Passage entre Conversation et Codex

Lorsqu’une tâche passe de Conversation à Codex ou inversement :

mettre à jour la fiche avec :

## Dernier état connu

- ce qui a été fait ;
- ce qui fonctionne ;
- ce qui échoue ;
- les fichiers modifiés ;
- les tests exécutés ;
- les tests restant à faire ;
- la prochaine action précise.

Ne pas dépendre uniquement de l’historique du chat précédent.

---

# Section obligatoire : prochaine action

Chaque fiche active doit contenir une section :

## Prochaine action

Elle doit indiquer une seule prochaine étape claire.

Exemple :

`Implémenter le composant validé derrière l’interface existante sans supprimer le fallback avant validation.`

Éviter les formulations vagues comme :

`continuer le travail`.

---

# Section obligatoire : reprise rapide

Chaque fiche active doit contenir :

## Reprise rapide

Avec au maximum :

- objectif ;
- état actuel ;
- dernier résultat de test ;
- blocage éventuel ;
- prochaine action.

Cette section permet à un nouvel agent de comprendre la tâche rapidement avant de lire tout le document.

---

# Historique des décisions

Lorsqu’une décision importante change pendant la tâche, ne pas simplement supprimer l’ancienne information.

Ajouter :

## Journal des décisions

Format :

### YYYY-MM-DD — Décision

**Décision :**

**Pourquoi :**

**Alternative rejetée :**

**Impact :**

Cela permet de comprendre pourquoi l’architecture a évolué.

---

# Tests

Les résultats doivent toujours mentionner la commande réellement exécutée.

Exemple correct :

`npm run eval:critical` → PASS

Exemple incorrect :

`Tests OK`

Si un test n’a pas été exécuté :

`NON TESTÉ`

---

# Travail local non lié

Si `git status` montre des modifications qui existaient avant la tâche :

les enregistrer dans :

## Modifications locales préexistantes

Ne pas les inclure automatiquement dans le périmètre de la tâche.

---

# Fin d’une tâche

Une tâche peut passer à `Terminé` seulement lorsque :

- le comportement demandé est implémenté ;
- les tests nécessaires sont documentés ;
- les limitations restantes sont connues ;
- la documentation nécessaire est mise à jour ;
- l’état Git est clair.

Un commit n’est pas obligatoire pour considérer une tâche comme techniquement terminée.

---

# Archivage

Ne pas supprimer automatiquement les anciennes fiches.

Elles constituent un historique technique utile.

Une tâche abandonnée peut être marquée :

`Bloqué`

ou :

`Abandonné`

avec une explication.

---

# Règle générale

La fiche doit décrire ce qui est réellement vrai.

Ne jamais écrire :

- PASS sans test ;
- validé sans validation ;
- packagé sans packaging ;
- testé matériellement sans test matériel ;
- terminé lorsque des étapes critiques restent ouvertes.
