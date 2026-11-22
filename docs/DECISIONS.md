# Journal des décisions

Règle 3 de `docs/ROADMAP.md` : toute exception à l'ordre des lots, et toute décision
structurante, est notée ici avec sa date et sa raison.

## 22/11/2026 — Adoption de la Roadmap V3 « Compagnon »

- `docs/ROADMAP.md` remplace la Roadmap Master V2.1, conservée comme archive des idées.
- Démarrage du lot V3-L0 (audit, lint réel, inventaire des services). État mesuré dans
  `docs/CURRENT_STATE.md`.

## 22/11/2026 — Compagnon iPhone gelé (P15)

- Les tranches IP-1 à IP-3 (côté Mac) ont été développées les 21 et 22/11, avant l'adoption de
  la V3 : passerelle LAN, vecteurs d'interopérabilité, section « Compagnon iPhone » du Control
  Center. Tout reste derrière le flag `remote.lan`, OFF par défaut. Rien n'écoute sur le
  réseau sans action explicite.
- Arrêt décidé par Arnaud le 22/11. Le code est conservé ; aucune nouvelle tranche (IP-4,
  app iOS) avant le critère de dégel de la roadmap : L2 et L3 utilisés chaque jour, en
  commençant par un simple canal de capture vers le Mac.
- Design de référence : `docs/IPHONE_COMPANION_V1_DESIGN.md`.

## 22/11/2026 — Gel des raffinements du cycle de vie des réservations (A.2)

- 4C-2 (`1d8e1bb`) et B3 (`316bae1`) sont commités et testés ; les correctifs B4a-B4c issus de
  l'essai du 21/11 aussi.
- On ne retouche plus la plomberie des réservations, du budget et des approbations du Goal
  Mode DEV, sauf si un usage réel révèle une faille.

## 22/11/2026 — Règles du lint (A.3)

- ESLint `recommended` + `no-undef`, `no-unused-vars`, `eqeqeq` ; zéro erreur exigée dans
  `npm run lint`.
- Exceptions assumées : paramètres non utilisés tolérés (signatures d'options des services),
  `catch {}` vide autorisé, `no-control-regex` désactivé (nettoyeurs d'entrées).
- `no-floating-promises` reporté à A.4 (nécessite les informations de types).

## 22/11/2026 — Nettoyage validé par Arnaud

- Suppression des dix fichiers morts listés dans `docs/CURRENT_STATE.md` §5.
- Scénario d'évaluation `voice.identity` aligné sur Cedar, voix canonique.

## 22/11/2026 — Charte de caractère activée par défaut (V3-L1)

- Les dix articles, les garde-fous du §5 et les cinq cadrans (`services/character/`) s'ajoutent
  à la personnalité de base pour le chat et la voix Live. Flag `character.charter` ON ; le
  passer à OFF rétablit la personnalité de base seule.
- Cadrans réglés dans les réglages rapides (section « Caractère »), stockés localement dans
  `character-preferences.json` (aucun secret). Défauts de la roadmap : franchise 4,
  challenge 3, initiative 3, proactivité 3, zone de confort 3.
- Critère de sortie de L1 : `npm run eval:character -- --run` (payant, ~0,24 USD sur
  gpt-5.6-terra), puis notation par Arnaud (`-- --grade`) ; il faut ≥ 90 % sur 30 cas.

## 22/11/2026 — « Je dois faire X » sur le petit modèle (V3-L2c)

- Un seul appel à `gpt-5.6-luna` (`store: false`, 400 jetons de sortie au plus), avec la
  personnalité et la charte ; seule la tâche est envoyée, ni mémoire ni historique. Refusé en
  mode local uniquement. Réponse validée (une action, 2 à 5 minutes), sinon erreur affichée.
- « Enregistrer comme prochaine action » : prochaine action du projet du Focus (nom exact),
  sinon note dans la boîte de réception. Aucun projet deviné.

## 22/11/2026 — Mesure d'usage du Brief (V3-L2d)

- Journal local `brief-usage-log.json` : par jour (Europe/Paris), heure prévue, première
  génération réussie et son déclencheur (planifié ou manuel), échec éventuel, première ouverture
  du Brief du jour. Aucun contenu stocké ; conservation 120 jours.
- « À l'heure » = généré le jour même, au plus 15 minutes après l'heure prévue.
- Bilan : `GET /daily-brief/usage?days=14`. Il sert au critère de sortie de L2 (utilisé chaque jour
  pendant deux semaines). `opens` compte les chargements de la vue, pas des lectures distinctes.

## 22/11/2026 — Exécutant externe dans un worktree isolé (V3-L5a)

- Lot suivant choisi par Arnaud : L5 (DEV par délégation), L3 restant bloqué par les critères de L1
  et de L2.
- `services/delegation/executor-worktree.js` : l'exécutant (Codex CLI) travaille dans un worktree
  Git détaché créé depuis HEAD, hors de tout dépôt (`~/.noon-dev/executor-worktrees` en
  développement, dossier de données sinon). Aucune branche, aucun checkout dans le dossier de
  travail d'Arnaud ; `node_modules` cloné en APFS ; hooks Git désactivés. Le diff est conservé en
  patch, le worktree est supprimé (sauf `keepWorktree`).
- Le dossier d'origine est comparé avant et après (statut, HEAD, contenu des fichiers modifiés) :
  toute modification fait échouer la mission. Un commit de l'exécutant aussi.
- Les changements non commités d'Arnaud ne sont pas visibles de l'exécutant ; le résultat
  l'indique (`sourceUncommittedChanges`).
- Bac à sable des validations : un worktree n'est accepté que s'il appartient à une mission
  active ; l'autorisation est vérifiée sur le dépôt d'origine (`isolatedWorkspaceResolver`). Les
  dossiers autorisés d'Arnaud ne sont pas élargis.
- Module générique distinct du worktree SelfDev (lié au dépôt Noon) ; convergence prévue en D.5.

## À trancher

- Réglages langue et accent de Live : à brancher ou à retirer de l'interface.
