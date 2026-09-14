# Noon — Tâche active

## Rôle

Ce fichier indique la tâche principale sur laquelle le développement de Noon travaille actuellement.

Il ne contient pas toute l’analyse technique.

Il pointe vers la fiche détaillée correspondante.

---

## Tâche active

**Nom :** AUCUNE TÂCHE ACTIVE

**Fichier :** AUCUN

**Niveau de risque :** À VÉRIFIER

**Statut :** À VÉRIFIER

**Phase actuelle :** AUCUNE

**Dernier outil utilisé :** À VÉRIFIER

**Dernière mise à jour :** 2026-09-12

---

## Reprise rapide

**Objectif :** Aucune fiche de tâche principale n’est actuellement présente dans `docs/tasks/`.

**Dernier résultat :** À VÉRIFIER

**Blocage :** Aucun blocage identifié; aucune tâche active n’est définie.

**Prochaine action :** Créer une fiche de tâche basée sur `docs/agents/TASK_TEMPLATE.md` lorsqu’une évolution importante sera engagée.

---

## Profil à utiliser maintenant

`AUCUN`

---

## Fiche détaillée

Aucune fiche détaillée active n’est actuellement référencée dans `docs/tasks/`.

---

# Règles de ACTIVE_TASK.md

`ACTIVE_TASK.md` est uniquement un pointeur rapide.

Ne pas dupliquer toute la fiche technique dedans.

La fiche détaillée reste la source de continuité.

Le code local réel reste la source de vérité technique.

---

# Changement de tâche active

Lorsqu’une autre tâche devient prioritaire :

mettre à jour `ACTIVE_TASK.md`.

Ne pas supprimer l’ancienne fiche.

Elle reste référencée dans `INDEX.md`.

---

# Une seule tâche principale

Il ne doit y avoir qu’une seule tâche déclarée comme tâche principale active dans `ACTIVE_TASK.md`.

Plusieurs autres tâches peuvent exister simultanément dans `INDEX.md`.

---

---

# Reprise automatique

Une fois ce système en place, lorsque l’utilisateur dit :

`Reprends la tâche active Noon.`

l’outil doit :

1. lire `AGENTS.md` ;
2. lire `docs/tasks/ACTIVE_TASK.md` ;
3. récupérer la fiche détaillée indiquée ;
4. appliquer `docs/agents/REPRISE_TACHE_NOON.md` ;
5. vérifier `git status --short` ;
6. comparer la fiche avec le code réel ;
7. charger le profil indiqué ;
8. continuer à la prochaine action valide.

---

# Changement de phase

Lorsqu’une phase se termine, par exemple `IMPLEMENTATION → QA`, mettre à jour :

1. la fiche détaillée ;
2. `INDEX.md` ;
3. `ACTIVE_TASK.md`.

Les trois doivent rester cohérents.

---

# Passage Conversation → Codex

Avant de quitter Conversation, mettre à jour :

- fiche détaillée ;
- `INDEX.md` ;
- `ACTIVE_TASK.md`.

Ainsi Codex peut ensuite reprendre uniquement avec :

`Reprends la tâche active Noon.`

---

# Passage Codex → Conversation

Même règle.

Le contexte important doit être enregistré dans le dépôt et non uniquement dans la conversation.
