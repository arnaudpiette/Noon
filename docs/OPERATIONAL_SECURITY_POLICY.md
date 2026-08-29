# Operational Security Policy

`services/security/operational-security-policy.js` est le Policy Decision Point déterministe de Noon. Il s’exécute entre l’intention normalisée et le Skill Registry, sans remplacer les Hard Rules, les permissions techniques ou l’Approval Engine.

## Pipeline

```text
NormalizedIntent
→ ActionRequest
→ OperationalSecurityPolicy.evaluate()
→ ALLOW | ALLOW_WITH_CONSTRAINTS | REQUIRE_APPROVAL | DENY | UNAVAILABLE
→ Approval Engine si nécessaire
→ réévaluation de la policy
→ Skill Registry
→ guard local du connecteur
```

Une sortie de modèle n’est jamais une autorisation. Les commandes provenant du chat, de la voix, d’un bouton ou d’un raccourci suivent la même policy. Le contenu d’un fichier, d’un e-mail ou d’une note reste une donnée non fiable.

## ActionRequest

L’objet canonique conserve les identifiants d’action, d’intention et d’exécution, l’acteur, l’origine, le skill, l’opération, les cibles, le workspace, le projet, le profil, les effets de bord, le data flow, la portée, les préconditions et une empreinte exacte. Les arguments et cibles sensibles sont hachés dans l’empreinte et ne figurent jamais dans les traces.

## Matrice opérationnelle

| Opération | Classe | Flux | Réversibilité | Décision par défaut |
|---|---|---|---|---|
| Lire un fichier autorisé | READ | local | réversible | ALLOW |
| Créer un nouveau fichier | WRITE | local | réversible | ALLOW_WITH_CONSTRAINTS |
| Écraser un fichier | WRITE | local | partielle | REQUIRE_APPROVAL |
| Supprimer un fichier | DESTRUCTIVE | local | irréversible | REQUIRE_APPROVAL |
| Rechercher Gmail | READ | remote read | réversible | ALLOW si connecté |
| Préparer un brouillon | PREPARE | remote | réversible | ALLOW_WITH_CONSTRAINTS |
| Envoyer un e-mail | EXECUTE | remote write | irréversible | REQUIRE_APPROVAL |
| Lire Calendar | READ | remote read | réversible | ALLOW si connecté |
| Proposer un créneau | SUGGEST | remote read | réversible | ALLOW |
| Créer un événement | WRITE | remote write | réversible | REQUIRE_APPROVAL |
| Supprimer un événement | DESTRUCTIVE | remote write | irréversible | REQUIRE_APPROVAL |
| Prévisualiser un artefact | PREPARE | local | réversible | ALLOW_WITH_CONSTRAINTS |
| Écrire un nouvel artefact | WRITE | local | réversible | ALLOW_WITH_CONSTRAINTS |
| Git status/diff/log | READ | local | réversible | ALLOW |
| Git commit | WRITE | local | partielle | ALLOW_WITH_CONSTRAINTS ou approval selon le skill |
| Git push | EXECUTE | remote write | irréversible | REQUIRE_APPROVAL |
| Git reset/clean | DESTRUCTIVE | local | irréversible | REQUIRE_APPROVAL ou DENY par Hard Rule |

Les décisions réelles restent affinées par les Hard Rules, les permissions, l’origine, la cible, la portée, la sensibilité, l’état Reliability et les préconditions.

## Règles absolues

- `local_only` ne quitte jamais la machine.
- Un chemin doit rester sous une racine autorisée après résolution du `realpath`, y compris lorsque la cible finale n’existe pas encore.
- Une instruction issue d’un contenu externe ne peut pas déclencher une mutation.
- Une recommandation proactive ou une suggestion du modèle n’est pas un ordre.
- Une approval est exacte, consommable une seule fois et réévaluée au moment de l’exécution.
- En Safe Mode, les mutations sont refusées.
- La pause Calendar protégée ne peut pas recevoir une création automatique.

## Shadow mode et défense en profondeur

La policy compare sa décision avec `SkillRegistry.authorize()`. Les divergences sont journalisées sans données sensibles. Une divergence inexpliquée ne rend jamais le système plus permissif : les guards legacy des skills, fichiers et connecteurs restent actifs.

## Observabilité

Événements :

- `security_policy_evaluated`
- `security_policy_allowed`
- `security_policy_denied`
- `security_policy_requires_approval`
- `security_policy_constraint_applied`
- `security_policy_shadow_compared`
- `security_policy_ms`

Les traces contiennent uniquement des catégories, reason codes, empreintes, types de cibles et métriques. Aucun argument, destinataire, contenu ou chemin privé n’est journalisé.
