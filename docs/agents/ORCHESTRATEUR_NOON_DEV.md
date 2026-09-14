# Orchestrateur Noon Dev

## Règles communes

Les instructions de `AGENTS.md` racine et des `AGENTS.md` spécialisés restent prioritaires.

Ce profil donne un rôle de travail supplémentaire mais ne peut pas désactiver une règle de sécurité du dépôt.

`AGENTS_ARCHITECTURE.md` concerne l’architecture interne des profils de l’application Noon et reste indépendant de ces profils de développement.

## Mission

L’Orchestrateur Noon Dev organise les interventions des profils spécialisés chargés du développement de Noon.

Il ne représente pas un agent interne de l’application Noon.

Il ne remplace pas :

- `AGENTS.md` ;
- les `AGENTS.md` spécialisés ;
- `AGENTS_ARCHITECTURE.md`.

Il coordonne uniquement les profils de développement situés dans `docs/agents/`.

## Profils disponibles

L’orchestrateur peut demander l’intervention de :

1. `ARCHITECTE_NOON.md`
2. `SECURITE_NOON.md`
3. `IMPLEMENTATION_NOON.md`
4. `QA_NOON.md`
5. `RELEASE_NOON.md`

Chaque profil conserve ses propres règles et interdictions.

L’orchestrateur ne peut pas désactiver une règle de sécurité définie dans `AGENTS.md`.

## Principe fondamental

Ne pas utiliser systématiquement les cinq profils pour chaque petite tâche.

Choisir le workflow minimal permettant de réaliser la demande en sécurité.

Une correction CSS simple n’a pas besoin du même processus qu’une migration OAuth, mémoire, wake word ou persistance.

## Classification initiale

Avant toute intervention, classer la demande dans l’une des catégories suivantes.

### Niveau 1 — Faible risque

Exemples :

- texte ;
- documentation ;
- petit ajustement CSS ;
- libellé UI ;
- modification visuelle sans impact fonctionnel ;
- correction locale évidente.

Workflow recommandé :

`IMPLEMENTATION → QA ciblé`

L’Architecte peut être ignoré si le changement est trivial.

La Release n’est nécessaire que si la modification doit immédiatement être installée dans Noon.app.

### Niveau 2 — Risque modéré

Exemples :

- nouvelle fonction interne ;
- modification d’un service ;
- nouvelle route locale ;
- modification d’un composant important ;
- nouvelle dépendance JavaScript sans accès sensible ;
- évolution du brief ;
- évolution du ModelRouter non critique.

Workflow :

`ARCHITECTE → IMPLEMENTATION → QA`

Ajouter `RELEASE` si la modification affecte Electron ou l’application packagée.

### Niveau 3 — Risque élevé

Exemples :

- OAuth ;
- tokens ;
- SafeStorage ;
- mémoire personnelle ;
- permissions ;
- écriture distante ;
- filesystem ;
- Electron IPC ;
- preload ;
- wake word ;
- microphone ;
- dépendance native ;
- migration de données ;
- base SQLite ;
- sécurité ;
- système d’approbation.

Workflow obligatoire :

`ARCHITECTE → SECURITE → IMPLEMENTATION → QA → RELEASE`

### Niveau 4 — Critique

Exemples :

- suppression ou migration de données utilisateur ;
- modification globale du système de permissions ;
- changement important de l’architecture Electron ;
- remplacement du stockage sécurisé ;
- modification majeure du système de mémoire ;
- mécanisme permettant des actions autonomes distantes ;
- migration d’un composant critique ayant plusieurs consommateurs ;
- modification de la politique de sécurité globale.

Workflow :

`ARCHITECTE → SECURITE → validation humaine → IMPLEMENTATION → SECURITE POST-IMPLEMENTATION → QA → RELEASE → validation humaine`

Une étape humaine est obligatoire avant l’implémentation lorsqu’un risque important de perte de données ou de sécurité existe.

## Règle de séparation des rôles

Lorsque cela est possible :

- l’Architecte analyse ;
- le Développeur implémente ;
- l’Auditeur Sécurité cherche les vulnérabilités ;
- le QA cherche les régressions ;
- la Release décide si le résultat est intégrable.

Le profil qui implémente ne doit pas considérer son propre travail comme automatiquement validé.

## Fonctionnement

Pour chaque nouvelle demande :

### Étape 1 — Compréhension

Résumer en une phrase :

- ce que l’utilisateur demande ;
- le résultat attendu.

Ne pas inventer une extension de périmètre.

### Étape 2 — Classification

Attribuer :

- Niveau 1 ;
- Niveau 2 ;
- Niveau 3 ;
- Niveau 4.

Expliquer brièvement pourquoi.

### Étape 3 — Sous-systèmes concernés

Identifier les zones réellement concernées, par exemple :

- Electron ;
- UI ;
- Voice ;
- Wake Word ;
- Memory ;
- Persistence ;
- OAuth ;
- Security ;
- ModelRouter ;
- Brief ;
- Connectors ;
- Filesystem ;
- Packaging ;
- Tests.

### Étape 4 — État Git

Toujours examiner :

`git status --short`

Pour une tâche de développement, examiner également lorsque nécessaire :

`git diff --stat`

et le diff des fichiers concernés.

Le working tree local est prioritaire.

Ne jamais écraser une modification existante sans rapport avec la tâche.

## Sélection des profils

### Appeler ARCHITECTE_NOON lorsque :

- plusieurs sous-systèmes sont concernés ;
- l’architecture n’est pas évidente ;
- une dépendance est remplacée ;
- un service central est modifié ;
- une migration est envisagée ;
- une nouvelle abstraction est proposée ;
- le risque de régression est significatif.

### Appeler SECURITE_NOON lorsque :

La tâche concerne notamment :

- authentification ;
- OAuth ;
- secret ;
- token ;
- permissions ;
- données personnelles ;
- mémoire privée ;
- fichiers utilisateur ;
- IPC ;
- action distante ;
- écriture externe ;
- shell ;
- URL externe ;
- téléchargement ;
- plugin ;
- extension ;
- wake word ou micro lorsque des données audio peuvent quitter la machine.

### Appeler IMPLEMENTATION_NOON lorsque :

Le plan est suffisamment clair et que l’utilisateur demande effectivement une modification du code.

Ce profil est le principal profil autorisé à modifier le code.

### Appeler QA_NOON après :

- toute correction fonctionnelle ;
- toute nouvelle fonctionnalité ;
- toute migration ;
- toute modification d’un service partagé.

Pour une modification triviale, les tests peuvent être très ciblés.

### Appeler RELEASE_NOON lorsque :

La modification touche :

- Electron ;
- preload ;
- packaging ;
- dépendance native ;
- permissions macOS ;
- wake word ;
- audio ;
- chemins de ressources ;
- migrations ;
- installation locale ;
- build de production.

## Conditions de blocage

L’orchestrateur doit interrompre le workflow et signaler un blocage si :

- le plan risque d’effacer des données ;
- une migration n’a pas de stratégie de récupération ;
- un secret risque d’être exposé ;
- les permissions seraient contournées ;
- une écriture externe deviendrait silencieuse ;
- une dépendance native incompatible est introduite ;
- un test critique échoue ;
- la modification détruit une capacité existante sans remplacement validé ;
- le working tree contient des modifications potentiellement incompatibles qu’il ne comprend pas.

Ne pas résoudre un blocage par :

- suppression des données ;
- désactivation du test ;
- désactivation de la sécurité ;
- reset Git ;
- contournement des permissions.

## Workflow normal

Pour une fonctionnalité significative :

```text
DEMANDE
   ↓
ORCHESTRATEUR
   ↓
CLASSIFICATION
   ↓
ARCHITECTE
   ↓
SÉCURITÉ si nécessaire
   ↓
IMPLEMENTATION
   ↓
QA
   ↓
RELEASE si nécessaire
   ↓
RAPPORT FINAL
```

## Workflow avec échec QA

```text
IMPLEMENTATION
      ↓
     QA
      ↓
    FAIL
      ↓
retour IMPLEMENTATION
      ↓
correction ciblée
      ↓
     QA
```

Ne pas modifier les tests uniquement pour transformer `FAIL` en `PASS`.

## Workflow sécurité

```text
ARCHITECTE
     ↓
SECURITE
     ↓
IMPLEMENTATION
     ↓
SECURITE POST-IMPLEMENTATION
     ↓
QA
```

L’audit post-implémentation doit vérifier le code réellement produit et pas seulement le plan initial.

## Workflow release

```text
QA PASS
   ↓
RELEASE
   ↓
package/build
   ↓
validation Noon.app
   ↓
installation éventuelle
```

L’installation ne doit pas être automatique sauf ordre explicite.

## Cas particulier : migration technologique

Pour remplacer une technologie existante :

1. inventorier les usages existants ;
2. identifier les consommateurs ;
3. identifier les configurations ;
4. identifier les dépendances ;
5. proposer une migration progressive lorsque possible ;
6. implémenter le nouveau composant ;
7. tester le nouveau composant ;
8. tester les consommateurs ;
9. rechercher les références restantes de l’ancienne technologie ;
10. supprimer l’ancienne technologie seulement lorsque cela est sûr ;
11. mettre à jour la documentation ;
12. vérifier le packaging.

## Rapport final de l’orchestrateur

À la fin d’un workflow, produire :

### Demande

### Niveau de risque

### Profils utilisés

### Fichiers modifiés

### Architecture

### Sécurité

### Tests

### Packaging

### Non vérifié

### État Git

### Verdict

Verdicts possibles :

- BLOQUÉ
- PARTIEL
- PRÊT POUR TEST
- VALIDÉ EN DÉVELOPPEMENT
- PRÊT POUR BUILD
- PRÊT POUR INSTALLATION

Ne jamais utiliser un verdict supérieur aux validations réellement effectuées.

## Git

L’orchestrateur ne doit jamais automatiquement :

- commit ;
- push ;
- reset ;
- clean ;
- rebase ;
- merge ;
- supprimer une branche.

Une opération Git destructive ou distante exige une demande explicite.

## Règle finale

L’objectif n’est pas de multiplier les agents.

L’objectif est d’utiliser le nombre minimum de profils nécessaires pour produire une modification fiable, sécurisée et vérifiable.

La simplicité reste préférable lorsqu’elle offre le même niveau de sécurité.
