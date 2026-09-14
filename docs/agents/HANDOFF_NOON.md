# Handoff Noon — Fin de session

## Mission

Ce protocole définit ce que Conversation VS Code, Codex ou tout autre outil de développement autorisé doit faire avant de terminer une session de travail sur Noon.

L’objectif est qu’un autre outil puisse reprendre immédiatement la tâche sans dépendre de l’historique du chat précédent.

Un handoff doit enregistrer l’état réel du travail.

Il ne doit jamais masquer :

- un test échoué ;
- une étape non terminée ;
- une validation manquante ;
- un problème de sécurité ;
- un changement local préexistant.

---

# 1. Quand effectuer un handoff

Effectuer un handoff lorsque :

- l’utilisateur demande d’arrêter ;
- l’utilisateur change de Conversation vers Codex ;
- l’utilisateur change de Codex vers Conversation ;
- une limite d’utilisation approche ;
- une tâche est interrompue ;
- une étape importante vient d’être terminée ;
- un blocage empêche la continuation ;
- une session de développement se termine.

---

# 2. Identifier la tâche active

Lire :

`docs/tasks/ACTIVE_TASK.md`

Puis récupérer la fiche détaillée correspondante dans :

`docs/tasks/`

Ne pas créer une nouvelle fiche si la tâche existe déjà.

Si aucune tâche active n’est définie, signaler :

`AUCUNE TÂCHE ACTIVE`

et ne pas inventer de contexte.

---

# 3. Vérifier le dépôt réel

Avant le handoff, exécuter :

```text
git status --short
```

Puis :

```text
git diff --stat
```

Examiner le diff des fichiers concernés lorsque nécessaire.

Identifier séparément :

- fichiers modifiés par la tâche actuelle ;
- fichiers déjà modifiés avant cette tâche ;
- fichiers non suivis ;
- éventuels fichiers accidentels.

---

# 4. Vérifier les tests

Lister uniquement les tests réellement exécutés pendant la session.

Format obligatoire :

```text
commande → résultat
```

Exemples :

```text
npm run lint → PASS
npm run eval:critical → PASS
npm test → FAIL
```

Ne jamais écrire simplement :

`tests OK`

Si une commande n’a pas été exécutée :

`NON EXÉCUTÉ`

---

# 5. Vérifier le niveau de validation

Distinguer :

- code écrit ;
- code syntaxiquement valide ;
- tests ciblés passés ;
- tests généraux passés ;
- test manuel effectué ;
- test matériel effectué ;
- test Electron effectué ;
- test Noon.app packagé effectué ;
- release validée.

Ne jamais transformer une validation partielle en validation complète.

---

# 6. Mettre à jour la fiche détaillée

Avant de terminer la session, mettre à jour la fiche de tâche avec au minimum :

## Dernier état connu

**Outil utilisé :**

Conversation VS Code / Codex / autre

**Date :**

**Phase actuelle :**

**Travail effectué :**

**Fichiers modifiés pendant cette session :**

**Tests exécutés :**

**Résultat :**

**Blocage éventuel :**

**Éléments non vérifiés :**

---

# 7. Mettre à jour Reprise rapide

La section :

`## Reprise rapide`

doit permettre de reprendre la tâche sans lire immédiatement tout le document.

Elle doit contenir uniquement les informations essentielles.

Format :

### Objectif

### État actuel

### Dernière validation

### Blocage

### Prochaine action

Rester concis.

---

# 8. Définir UNE prochaine action

Mettre à jour :

`## Prochaine action`

avec une seule étape concrète.

Exemple correct :

`Implémenter le composant validé derrière l’interface existante, sans retirer le fallback avant validation.`

Exemples incorrects :

`Continuer.`

`Finir la migration.`

`Faire les tests et corriger les problèmes.`

La prochaine action doit permettre au prochain outil de savoir exactement par où commencer.

---

# 9. Mettre à jour le statut

Mettre le statut réel.

Exemples :

- Analyse en cours
- Prêt pour implémentation
- Implémentation en cours
- Prêt pour QA
- Correction requise
- Prêt pour Release
- Bloqué
- Prêt pour installation
- Terminé

Ne jamais utiliser `Terminé` simplement parce que la session se termine.

---

# 10. Mettre à jour INDEX.md

Synchroniser l’entrée correspondante dans :

`docs/tasks/INDEX.md`

Mettre à jour uniquement si nécessaire :

- statut ;
- risque ;
- date ;
- prochaine action.

Ne pas modifier les autres tâches sans raison.

---

# 11. Mettre à jour ACTIVE_TASK.md

Mettre à jour :

- nom ;
- fichier ;
- risque ;
- statut ;
- phase ;
- dernier outil ;
- dernière mise à jour ;
- objectif ;
- dernier résultat ;
- blocage ;
- prochaine action ;
- profil à utiliser maintenant.

`ACTIVE_TASK.md` doit rester très court.

---

# 12. Choisir le prochain profil

Déterminer quel profil doit reprendre.

Choisir un seul profil principal :

- `ARCHITECTE_NOON`
- `SECURITE_NOON`
- `IMPLEMENTATION_NOON`
- `QA_NOON`
- `RELEASE_NOON`
- `AUCUN`

Exemple :

si l’implémentation est terminée mais pas auditée :

`QA_NOON`

Si une vulnérabilité a été trouvée :

`IMPLEMENTATION_NOON`

Si la QA est PASS et que le changement touche Electron :

`RELEASE_NOON`

---

# 13. Cas d’un test en échec

Si un test échoue au moment du handoff :

ne pas essayer de masquer cet état.

Documenter :

### Test en échec

**Commande :**

**Erreur :**

**Hypothèse actuelle :**

**Fichiers potentiellement concernés :**

**Prochaine action :**

Statut recommandé :

`Correction requise`

ou :

`Bloqué`

selon le problème.

---

# 14. Cas d’un blocage

Si la session se termine à cause d’un blocage :

documenter :

### Blocage

**Cause :**

**Ce qui a été vérifié :**

**Ce qui a été tenté :**

**Ce qu’il ne faut pas refaire inutilement :**

**Élément nécessaire :**

**Prochaine action après déblocage :**

---

# 15. Modifications locales préexistantes

Toujours conserver une distinction entre :

### Changements de cette tâche

et

### Modifications déjà présentes avant la tâche

Ne jamais attribuer au travail actuel des modifications qui existaient auparavant.

---

# 16. Ne pas toucher à Git automatiquement

Un handoff ne doit jamais effectuer automatiquement :

- commit ;
- push ;
- reset ;
- clean ;
- stash ;
- rebase ;
- merge.

Le handoff décrit l’état Git.

Il ne le modifie pas sauf ordre explicite de l’utilisateur.

---

# 17. Contrôle sécurité final

Avant de terminer :

vérifier dans le diff qu’aucun élément évident ne contient :

- clé API ;
- token ;
- mot de passe ;
- secret OAuth ;
- AccessKey ;
- donnée personnelle privée ;
- base utilisateur ;
- mémoire privée.

Si un secret est détecté :

le handoff doit être marqué :

`BLOQUÉ`

et le problème doit être signalé immédiatement.

---

# 18. Rapport de fin de session

À la fin du handoff, afficher :

# Handoff Noon

**Tâche :**

**Statut :**

**Phase :**

**Travail effectué :**

**Fichiers modifiés :**

**Tests :**

**État Git :**

**Blocage :**

**Non vérifié :**

**Prochain profil :**

**Prochaine action :**

---

# 19. Passage vers Codex

Lorsque Conversation prépare un handoff vers Codex :

le dernier message doit pouvoir être suivi par :

`Reprends la tâche active Noon.`

Codex ne doit pas avoir besoin de l’historique Conversation pour comprendre la suite.

---

# 20. Passage vers Conversation

Même principe.

Conversation doit pouvoir reprendre uniquement à partir :

- du dépôt ;
- de `ACTIVE_TASK.md` ;
- de la fiche de tâche ;
- du protocole de reprise.

---

# 21. Règle fondamentale

Une bonne fin de session ne consiste pas à écrire beaucoup de texte.

Elle consiste à laisser :

- un dépôt intact ;
- une fiche exacte ;
- un état Git connu ;
- des tests documentés ;
- une prochaine action claire.

Le prochain outil doit pouvoir reprendre sans deviner.
