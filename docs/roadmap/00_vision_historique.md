# NOON — ROADMAP INTÉGRALE DEPUIS LA CRÉATION

**Édition actualisée : 12 octobre 2026 · Priorité P0 voix Cedar/GPT-Live/Realtime + historique, V2/V3, V4/V5**  
**Référence projet : « Projet NOON #Terminal 03 », « Projet NOON #2 », autres conversations sur Noon et branche GitHub `v2/multi-provider`.**

> **Ce qu’est ce document.** Une reconstruction consolidée des décisions fonctionnelles et techniques depuis le démarrage de Noon, en distinguant l’historique, les réalisations documentées, les validations réelles, les limites et les projets futurs. Ce n’est **pas** un audit live du Mac. Les états connus sur la branche distante ne garantissent ni le HEAD local ni les changements non poussés. Aucun fichier du dépôt Git, aucune conversation passée et aucun paramètre d’exécution de Noon n’ont été modifiés.
>
> **Précision sur l’origine.** Le premier commit identifié dans l’histoire de la branche consultée est `dff3160` (« Build Noon desktop assistant »), daté du **22 août 2026**. Cela fournit une première trace Git vérifiable, **pas forcément la date de la première idée**. La V1 a été pilotée à travers une roadmap historique de **45 étapes** ; leurs 45 libellés originaux n’ont pas tous été retrouvés : les phases ci-dessous sont une reconstitution **par thèmes**, pas une fausse transcription 1→45.

## 0 — Vision et règles fondatrices

**Mission :** créer « Noon », un assistant IA personnel macOS, local-first, à identité cohérente, capable de discuter oralement et par écrit, de se souvenir, de comprendre tes projets, d’organiser le quotidien, de créer, de coder et, progressivement, d’**anticiper → proposer → agir de manière contrôlée → vérifier → apprendre**.

**Positionnement actuel (décisions les plus récentes) :**

- **Un seul utilisateur**, toi, sur **Mac et iPhone** ; pas de multi-tenant ni d’infrastructure SaaS à développer maintenant.
- **Mac = cœur privé / source de vérité** des données et des exécutions. **iPhone = compagnon** de chat, voix, brief, alertes, jobs, continuité, avec synchronisation chiffrée et consentie. Apple Watch est une éventualité tardive.
- **Un seul Noon visible** : les moteurs et agents spécialisés opèrent derrière cette interface, sans mémoires concurrentes ni orchestrateurs rivaux.
- Trois espaces cohérents : **Personnel / DA-création / DEV**, plus un **Focus projet** contextuel.
- **Local-first ≠ modèle IA intégralement local** : données locales et confidentialité par défaut ; modèles cloud optionnels seulement si autorisés ; mode `local_only` réellement respecté.
- Les règles d’autorité sont stables : **Security Policy → Intervention Permissions → Approval Engine → Transactional Execution → Evaluation**, sans élévation implicite des privilèges.
- L’utilisateur conserve le contrôle des mémoires, décisions, accès, dépenses, actions engageantes et suppressions.
- Éviter la sur-ingénierie : réutiliser les moteurs existants, prouver la valeur en conditions réelles, geler le SaaS et les architectures artificiellement complexes.

**Convention d’état :** `VALIDÉ` = une preuve indiquée existe dans les conversations ou la documentation ; `PARTIEL` = développé/testé dans un périmètre mais validation utilisateur complète manquante ; `SHADOW/LIMITED` = non activé comme fonction libre de production ; `PRÉPARÉ` = contrats/mocks sans usage réel ; `À FAIRE` = fonctionnalité explicitement prévue ; `EXPLORATOIRE` = idée conservée hors périmètre immédiat.

## 1 — Frise historique depuis la création

| Période / phase | Évolution | État établi |
|---|---|---|
| **22–23 août 2026 : origine Git identifiée** | Prototype puis application macOS Electron/Node, premières conversations, intégrations, Focus, identité Noon, premières mesures de sécurité et packaging. | Première trace Git du 22/08 ; implémentations initiales documentées fin août. |
| **Fin août : V1, 45 étapes** | Extension du prototype vers un assistant complet : chat/voix, mémoire, projets, brief, recherche, outils, sécurité, artefacts, planning, tâches, évaluations, jobs, offline et architecture canonique. | Plusieurs composants testés, étape 44 = production hardening et étape 45 = audit/release ; pas un lancement grand public. |
| **1–13 septembre : V1 en stabilisation** | ONE NOON, tests d’acceptation, sécurité, mémoire chiffrée, exécutions exactes, packaging x64 et audits en conditions packagées, P1.2/1.3/1.4/1.5. | `INTERNAL_ALPHA_READY` ; usage réel partiel ; signature et notarisation non prouvées. |
| **12–20 septembre : lancement V2** | V2.1–2.6 : providers, privacy, routing, second opinion, délégation agents/Codex, noyau DEV ; archi d’exécution locale. | Briques réelles avec flags restrictifs et preuves variables. |
| **21–29 septembre : DEV Workspace + intelligence** | Terminal multi-sessions, Preview, Git Diff, Problems, Source Control, Agent Loop, captures, règles de projet, multi-agents B3, nouveau Daily Brief. | Plusieurs tranches fermées et tests nombreux ; validation UI réelle à compléter selon le périmètre. |
| **Fin septembre–7 octobre : DEV natif, persistance, sécurité** | Native DEV, Goal Strategy et SQLite, Approval/Permission, Context Offloader, UX/observabilité, validations et budgets. | Livraisons locales et commitées multiples ; sécurité et coûts à revalider avant autonomie. |
| **8–10 octobre : décision fondée sur preuves** | Agent Evaluation Runtime, Sandbox V1 applicative, Uncertainty & Decision V1, Evidence Adapters, couplage Goal/DEV. | Commits sur `v2/multi-provider` visibles jusqu’au 10/10 ; pas de sandbox OS générale prouvée. |
| **11 octobre : arbitrage produit** | Mode DEV d’abord, **Figma V2 ensuite**, **SelfDev V1 en deuxième**, **iPhone V2 en parallèle** ; proactivité et quotidien transverses. | Priorités produit exprimées explicitement ; pas encore une nouvelle release. |
| **12 octobre : consolidation présente** | Roadmap **historique + actuelle + futur** réunie et corrections des contradictions documentaires. | Document de référence, pas modification du dépôt. |
| **12 octobre : arbitrage voix prioritaire** | **Cedar primaire en attendant Arbor** ; test `gpt-live-1` full-duplex avec délégation au backend Noon et `gpt-realtime-2.1`/mini ; voix désormais P0 aux côtés du DEV. | Décision produit ; **aucun déploiement ni test API projet revendiqué**. |

