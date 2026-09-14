# Modèle de tâche Noon

## Identification
**Nom de la tâche :**

**Date :**

**Demande utilisateur :**

**Responsable / outil utilisé :**

- Conversation VS Code
- Codex
- autre

**Statut :**

- À analyser
- Analyse en cours
- Prêt pour implémentation
- Implémentation en cours
- QA
- Release
- Bloqué
- Terminé

---

# 1. Objectif

Décrire précisément ce qui doit être obtenu.

L’objectif doit répondre à :

- quel problème est résolu ?
- quel comportement est attendu ?
- quel résultat visible ou technique doit être obtenu ?

Ne pas inclure ici des améliorations non demandées.

---

# 2. Hors périmètre

Lister explicitement ce qui ne doit pas être modifié.

Exemples :

- UI non concernée ;
- mémoire ;
- OAuth ;
- ModelRouter ;
- autres intégrations ;
- architecture globale ;
- fichiers utilisateur.

Cette section sert à éviter l’élargissement involontaire de la tâche.

---

# 3. Niveau de risque

Choisir selon `ORCHESTRATEUR_NOON_DEV.md` :

- Niveau 1 — faible risque
- Niveau 2 — risque modéré
- Niveau 3 — risque élevé
- Niveau 4 — critique

### Justification

Expliquer brièvement pourquoi ce niveau a été choisi.

---

# 4. Sous-systèmes concernés

Cocher uniquement les domaines réellement concernés :

- [ ] Electron
- [ ] Renderer
- [ ] Preload / IPC
- [ ] UI
- [ ] Server
- [ ] Voice
- [ ] Wake Word
- [ ] Memory
- [ ] Persistence
- [ ] Security
- [ ] OAuth
- [ ] Connectors
- [ ] ModelRouter
- [ ] Daily Brief
- [ ] Filesystem
- [ ] Focus
- [ ] Automations
- [ ] Notifications
- [ ] Extensions
- [ ] Tests
- [ ] Packaging
- [ ] macOS
- [ ] x64
- [ ] arm64
- [ ] Documentation
- [ ] Autre :

---

# 5. État Git avant intervention

Documenter :

```text
git status --short
```

Puis si nécessaire :

```text
git diff --stat
```

### Modifications locales déjà présentes

Lister les fichiers déjà modifiés avant cette tâche.

Ces modifications doivent être considérées comme appartenant potentiellement à l’utilisateur et ne doivent pas être écrasées.

---

# 6. Architecture actuelle

Décrire brièvement le fonctionnement actuel du sous-système.

Identifier :

- point d’entrée ;
- service principal ;
- consommateurs ;
- configuration ;
- données persistantes ;
- tests existants ;
- dépendances.

Ne pas proposer la solution avant d’avoir décrit l’existant.

---

# 7. Fichiers concernés

### Fichiers à lire

- ...

### Fichiers probablement à modifier

- ...

### Fichiers qui ne doivent pas être modifiés

- ...

Ne pas modifier un fichier simplement parce qu’il semble lié au sujet.

---

# 8. Dépendances

## Dépendances existantes utilisées

- ...

## Nouvelle dépendance nécessaire

- [ ] Oui
- [ ] Non

Si oui :

**Nom :**

**Pourquoi :**

**Alternative sans nouvelle dépendance :**

**Compatibilité Electron :**

**Compatibilité macOS x64 :**

**Compatibilité macOS arm64 :**

**Impact packaging :**

**Impact sécurité :**

---

# 9. Analyse Architecte Noon

### Fonctionnement actuel

### Problème identifié

### Solution minimale recommandée

### Interfaces à préserver

### Risques de régression

### Alternatives envisagées

### Choix retenu

---

# 10. Audit Sécurité avant implémentation

Remplir lorsque requis par le niveau de risque.

### Données sensibles concernées

### Permissions concernées

### Secrets / tokens

### IPC

### Fichiers utilisateur

### Services distants

### Écritures externes

### Risques identifiés

### Protections nécessaires

### Verdict avant implémentation

- BLOQUANT
- À CORRIGER
- ACCEPTABLE AVEC RÉSERVES
- OK

---

# 11. Plan d’implémentation

Décomposer en petites étapes.

Exemple :

1. ajouter/adapter l’interface ;
2. implémenter le nouveau service ;
3. connecter le service existant ;
4. préserver le fallback ;
5. ajouter les tests ;
6. mettre à jour la documentation.

Chaque étape doit pouvoir être vérifiée indépendamment autant que possible.

---

# 12. Implémentation

Pour chaque modification réalisée :

### Étape

**Fichiers modifiés :**

**Modification :**

**Pourquoi :**

**Compatibilité préservée :**

**Test associé :**

---

# 13. Écarts par rapport au plan

Si l’implémentation réelle diffère du plan initial, documenter :

- ce qui a changé ;
- pourquoi ;
- impact ;
- nouvelle validation nécessaire.

Ne jamais masquer un changement d’architecture apparu pendant l’implémentation.

---

# 14. Audit Sécurité post-implémentation

Pour Niveau 3 ou Niveau 4 lorsque nécessaire.

Examiner le code réellement produit.

### Nouveaux chemins fonctionnels

### Nouveaux accès aux données

### Permissions

### Logs

### Secrets

### Contournements possibles

### Régression sécurité

### Verdict

- BLOQUANT
- À CORRIGER
- ACCEPTABLE AVEC RÉSERVES
- OK

---

# 15. QA

## Tests ciblés

Commande :

Résultat :

## Lint

Commande :

Résultat :

## Tests généraux

Commande :

Résultat :

## Évaluations Noon

Commande :

Résultat :

## Régressions recherchées

- ...

## Bugs identifiés

- ...

---

# 16. Tests manuels

Distinguer clairement les tests réellement effectués des tests restant à faire.

### Effectués

- ...

### Non effectués

- ...

### Tests nécessitant du matériel réel

- microphone
- AirPods
- veille/réveil macOS
- autorisations système
- autre :

Un test automatisé ne doit jamais être indiqué comme équivalent à un test matériel réel.

---

# 17. Packaging

Remplir lorsque pertinent.

### Build développement

- Non testé
- PASS
- FAIL

### Build x64

- Non testé
- PASS
- FAIL

### Build arm64

- Non testé
- PASS
- FAIL

### Application Noon.app

- Non testée
- PARTIAL
- PASS
- FAIL

### Ressources packagées

### Dépendances natives

### Permissions macOS

---

# 18. Migration de données

Si la tâche modifie la persistance :

### Ancien format

### Nouveau format

### Migration

### Idempotence

### Sauvegarde

### Rollback

### Test avec données existantes

Ne jamais considérer une migration comme validée uniquement avec une base vide.

---

# 19. Documentation

Documents à mettre à jour :

- README
- AGENTS_ARCHITECTURE
- documentation du sous-système
- procédure d’installation
- documentation utilisateur
- aucune documentation nécessaire

### Documents réellement modifiés

- ...

---

# 20. Diff final

Avant conclusion :

```text
git status --short
git diff --stat
```

Examiner également le diff complet des fichiers modifiés.

Vérifier :

- aucun secret ;
- aucune donnée privée ;
- aucun fichier sans rapport ;
- aucun changement accidentel ;
- aucun test supprimé sans justification.

---

# 21. Fichiers modifiés par cette tâche

Lister uniquement les fichiers réellement modifiés par cette tâche.

- ...

---

# 22. Fichiers préexistants déjà modifiés

Lister séparément les changements présents avant la tâche.

Ne jamais les présenter comme étant produits par cette tâche.

- ...

---

# 23. Ce qui est validé

Lister seulement ce qui a réellement été vérifié.

- ...

---

# 24. Ce qui reste non vérifié

Lister explicitement :

- tests matériels ;
- API réelles ;
- OAuth réel ;
- application packagée ;
- arm64 ;
- installation locale ;
- données réelles ;
- autre.

---

# 25. Verdict final

Choisir uniquement parmi :

- BLOQUÉ
- PARTIEL
- PRÊT POUR TEST
- VALIDÉ EN DÉVELOPPEMENT
- PRÊT POUR BUILD
- PRÊT POUR INSTALLATION
- TERMINÉ

Ne jamais choisir un verdict supérieur aux preuves disponibles.

---

# 26. Git

### Commit effectué

NON par défaut.

### Push effectué

NON par défaut.

Aucun commit ou push sans demande explicite de l’utilisateur.

---

# Règle essentielle

Ce document doit représenter la réalité de la tâche.

Il ne doit pas devenir une checklist remplie artificiellement pour donner l’impression qu’une fonctionnalité est validée.

Une case non testée doit rester non testée.

Un échec doit rester visible jusqu’à sa résolution.
