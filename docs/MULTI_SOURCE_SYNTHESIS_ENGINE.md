# Multi-Source Synthesis Engine

Le moteur de synthèse consomme exclusivement un `EvidencePack` produit par le `PersonalSearchEngine`. Il ne recherche pas lui-même les sources et ne crée aucun stockage parallèle.

## Pipeline

```text
question → PersonalSearchEngine → passages pertinents → normalisation
→ claims → déduplication → ordre temporel → conflits → synthèse structurée
```

Les fichiers, conversations, threads et documents complets ne sont jamais chargés automatiquement. Le budget par défaut est de 20 passages et 6 000 tokens estimés. Le budget est réparti entre les sources pour préserver un désaccord important au lieu de laisser le premier document occuper tout l’espace.

## Modes

- `SUMMARY`
- `COMPARE`
- `TIMELINE`
- `CURRENT_STATE`
- `CONFLICT_ANALYSIS`
- `DECISION_HISTORY`
- `DIFF`

Le mode est détecté localement ou fourni explicitement par l’orchestrateur.

## Claims et conflits

Le moteur extrait seulement des affirmations utiles à une comparaison : affectations, états, décisions explicites et phrases principales. Les affirmations identiques sont regroupées, mais leurs `evidenceIds`, citations et racines indépendantes restent disponibles.

Types de conflits : `VALUE_CONFLICT`, `VERSION_CONFLICT`, `TEMPORAL_AMBIGUITY`, `SOURCE_DISAGREEMENT` et `STATUS_CONFLICT`. Une évolution datée ou une valeur explicitement historique n’est pas considérée comme une contradiction active. Deux configurations actuelles incompatibles restent ambiguës.

L’autorité dépend de la question : code et configuration pour l’état technique, conversations et mémoire pour l’historique personnel, Calendar pour l’agenda actuel. Une mémoire candidate ne remplace jamais une mémoire confirmée.

## Provenance et drill-down

Chaque claim référence des `evidenceIds` et `citationIds`. Une citation n’existe que lorsqu’un localisateur réel est disponible. Le registre de drill-down est éphémère : il permet de retrouver le passage sans nouvelle synthèse, puis réévalue les permissions avant exposition.

## Confidentialité

La synthèse n’accorde aucune permission. Elle réévalue profil, projet, chemin autorisé et état des connecteurs. En mode distant, `local_only` et les preuves non autorisées sont exclues avant normalisation. Une synthèse locale peut les exploiter sans les envoyer au modèle.

Les contenus issus de fichiers, notes et e-mails sont marqués `untrustedContent`. Ils restent des données et ne peuvent jamais déclencher un outil ou une action. Toute action doit repasser par l’orchestrateur, le Skill Registry, les Hard Rules et l’Approval Engine.

## Context Builder et outils

Le skill `synthesize_personal_sources` effectue la recherche puis transmet uniquement une synthèse structurée compacte au Context Builder. Les passages bruts restent disponibles localement pour les citations et le drill-down.

Routes locales :

- `POST /personal-synthesis`
- `POST /personal-synthesis/drill-down`

Elles exigent `X-Noon-Request: 1`.

## Cache et observabilité

Le cache mémoire est borné à 50 entrées et 30 secondes. Sa clé combine requête, mode, politique, finalité et fingerprint des preuves. Les changements de conversation, mémoire ou projet invalident recherche et synthèse.

Les métriques enregistrent uniquement modes, compteurs, confiance et durées : normalisation, claims, conflits et durée totale. Aucun texte de preuve ni requête privée n’est journalisé.

## Choix du modèle

La synthèse structurelle actuelle est déterministe et n’effectue aucun appel IA supplémentaire. Elle constitue donc son propre fallback et ne peut pas échouer à cause d’un modèle. Une reformulation distante future devra passer par le routeur Luna/Terra/Sol et recevoir uniquement le bloc compact autorisé.
