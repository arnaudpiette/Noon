# Reprise de tâche Noon

## Mission

Ce protocole permet à Conversation VS Code, Codex ou un autre outil de développement autorisé de reprendre une tâche Noon déjà commencée.

L’objectif est de continuer à partir de l’état réel du dépôt et de la fiche de tâche, sans refaire inutilement tout le travail déjà effectué.

La reprise ne doit jamais se baser uniquement sur le texte de la fiche.

Le working tree et le code local actuel restent prioritaires.

---

# 1. Informations requises

Pour reprendre une tâche, l’utilisateur peut fournir :

- le nom du fichier de tâche ;
- ou simplement demander de reprendre une tâche précise.

Exemple :

`Reprends la tâche indiquée dans ACTIVE_TASK.md.`

Lorsque le fichier correspondant est identifiable sans ambiguïté, ne pas demander à l’utilisateur de répéter tout le contexte.

---

# 2. Chargement obligatoire

Avant de continuer une tâche, lire dans cet ordre :

1. `AGENTS.md`
2. les `AGENTS.md` spécialisés applicables
3. `docs/agents/ORCHESTRATEUR_NOON_DEV.md`
4. le profil correspondant à l’étape actuelle
5. `docs/tasks/README.md`
6. la fiche de tâche concernée

Si la tâche concerne plusieurs sous-systèmes, lire les instructions spécialisées correspondantes.

---

# 3. Vérification Git obligatoire

Avant toute modification :

```text
git status --short
```

Puis lorsque nécessaire :

```text
git diff --stat
git diff
```

Comparer l’état actuel du working tree avec celui décrit dans la fiche.

Le working tree local actuel est prioritaire.

Ne jamais ramener automatiquement le dépôt à l’état décrit dans la fiche.

---

# 4. Vérification de cohérence

Comparer :

- fichiers indiqués dans la fiche ;
- fichiers réellement modifiés ;
- tests annoncés ;
- état du code ;
- prochaine action ;
- éventuels changements effectués depuis la dernière mise à jour.

Si la fiche est devenue obsolète :

mettre d’abord à jour la fiche.

Ne pas modifier le code pour le faire correspondre à une ancienne description.

---

# 5. Reprise rapide

Lire en priorité la section :

`## Reprise rapide`

Elle doit permettre d’identifier :

- objectif ;
- état actuel ;
- dernier résultat connu ;
- blocage éventuel ;
- prochaine action.

Ensuite vérifier ces informations contre le dépôt réel.

---

# 6. Identifier l’étape actuelle

Déterminer précisément si la tâche est actuellement en :

- Analyse
- Sécurité
- Implémentation
- QA
- Correction
- Release
- Test manuel
- Bloqué
- Terminé

Ne pas recommencer automatiquement depuis l’Architecture si cette étape a déjà été correctement réalisée et que rien ne l’a invalidée.

---

# 7. Sélectionner le bon profil

Selon l’état de la tâche, charger :

### Analyse

`docs/agents/ARCHITECTE_NOON.md`

### Audit sécurité

`docs/agents/SECURITE_NOON.md`

### Implémentation

`docs/agents/IMPLEMENTATION_NOON.md`

### QA

`docs/agents/QA_NOON.md`

### Release

`docs/agents/RELEASE_NOON.md`

Ne charger que les profils nécessaires.

---

# 8. Prochaine action

Lire :

`## Prochaine action`

Puis vérifier qu’elle reste valable.

Si elle est toujours correcte :

continuer à partir de cette action.

Si elle n’est plus correcte :

mettre à jour la fiche avant de continuer.

Une prochaine action doit être concrète.

Exemple correct :

`Implémenter le composant validé derrière l’interface existante.`

Exemple incorrect :

`Continuer.`

---

# 9. Ne pas répéter inutilement le travail

Ne pas refaire automatiquement :

- une analyse déjà validée ;
- un audit déjà valide ;
- les mêmes recherches de fichiers ;
- les mêmes tests si aucun code concerné n’a changé.

En revanche, refaire une validation lorsqu’un changement ultérieur peut l’avoir invalidée.

Exemple :

si l’implémentation a changé après un audit Sécurité, un nouvel audit post-implémentation peut être nécessaire.

---

# 10. Gestion d’un changement externe

Si le dépôt a été modifié depuis la dernière session :

identifier si ces changements :

- appartiennent à la tâche ;
- appartiennent à une autre tâche ;
- sont des modifications utilisateur ;
- rendent l’ancien plan obsolète.

Ne jamais supprimer ou écraser un changement dont l’origine n’est pas clairement attribuée à la tâche courante.

---

# 11. Mise à jour de la fiche pendant le travail

Après chaque étape significative, mettre à jour la fiche avec :

- ce qui a été réalisé ;
- fichiers modifiés ;
- tests exécutés ;
- résultat ;
- problème rencontré ;
- décision prise ;
- prochain état ;
- prochaine action.

Ne pas attendre la fin complète de la tâche pour documenter plusieurs heures de travail.

---

# 12. Changement d’outil

Conversation et Codex doivent pouvoir reprendre la même tâche.

Lorsqu’un outil termine sa session :

mettre à jour dans la fiche :

## Dernier état connu

Inclure :

- outil utilisé ;
- travail effectué ;
- fichiers modifiés ;
- tests ;
- résultat ;
- blocage ;
- prochaine action.

L’outil suivant ne doit pas dépendre de l’historique du chat précédent.

---

# 13. Passage Conversation → Codex

Avant le passage :

Conversation doit :

1. sauvegarder l’état de la tâche dans la fiche ;
2. indiquer précisément ce qui a été modifié ;
3. indiquer les tests réellement exécutés ;
4. indiquer la prochaine action ;
5. ne pas inventer de validation.

Codex doit ensuite :

1. relire la fiche ;
2. vérifier Git ;
3. vérifier le code ;
4. confirmer ou corriger l’état documenté ;
5. continuer.

---

# 14. Passage Codex → Conversation

Même principe.

Le contexte doit se trouver dans le dépôt et non uniquement dans la conversation Codex.

---

# 15. Gestion des conflits

Si le code réel et la fiche se contredisent :

ne pas choisir arbitrairement la fiche.

Examiner :

1. le working tree ;
2. l’historique récent ;
3. le code actuel ;
4. les tests ;
5. la fiche.

Documenter ensuite la conclusion.

---

# 16. Tâche bloquée

Si un blocage empêche la continuation :

mettre :

`Statut : Bloqué`

Documenter :

### Blocage

### Cause

### Ce qui a déjà été tenté

### Ce qui fonctionne

### Ce qui ne fonctionne pas

### Élément nécessaire pour débloquer

### Prochaine action après déblocage

Ne pas contourner une protection importante uniquement pour débloquer la tâche.

---

# 17. Tâche terminée

Avant de marquer :

`Terminé`

vérifier :

- objectif atteint ;
- tests nécessaires documentés ;
- limitations restantes documentées ;
- documentation mise à jour ;
- état Git connu ;
- pas de secret dans le diff ;
- pas de fichier accidentel.

Si un test matériel ou de production essentiel manque, utiliser un statut intermédiaire plus honnête.

---

# 18. Résumé obligatoire à chaque reprise

Avant de commencer les modifications, afficher un résumé court :

## Tâche reprise

**Tâche :**

**Niveau de risque :**

**État actuel :**

**Dernière validation :**

**Fichiers locaux déjà modifiés :**

**Prochaine action :**

**Profil utilisé :**

Puis continuer.

---

# 19. Commande conceptuelle de reprise

Lorsque l’utilisateur dit :

`Reprends la tâche <nom>.`

Interpréter cela comme :

1. trouver la fiche correspondante dans `docs/tasks/` ;
2. appliquer ce protocole ;
3. reprendre à la prochaine action valide.

Ne pas demander à l’utilisateur de recopier l’historique si la fiche contient déjà les informations nécessaires.

---

# 20. Règle finale

Une fiche de tâche est un journal de continuité.

Elle aide à reprendre le travail mais ne remplace jamais la vérification du dépôt réel.

Toujours préférer :

réalité du dépôt → validation → fiche à jour

plutôt que :

fiche ancienne → suppositions → modification du code.
