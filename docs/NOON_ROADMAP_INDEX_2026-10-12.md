# NOON — Roadmap intégrale depuis la création

**Édition initiale : 12 octobre 2026 — avenant Google OAuth agentique du 13 octobre 2026.**

L'édition initiale reproduit les **425 lignes de la roadmap consolidée**, réparties en chapitres Markdown pour faciliter la lecture et les mises à jour. Elle réunit les décisions des conversations « Projet Noon #2 », « Terminal 03 » et des audits produit. Elle documente une **vision et des états rapportés**, pas une certification du runtime Mac ni une autorisation de modifier l'application.

## Priorités actuelles

- **P0-A — Voix :** Cedar comme voix temporaire cible, en attendant Arbor officiellement disponible dans l'API ; comparer GPT-Live et la nouvelle génération GPT-Realtime dans le pipeline sécurisé de Noon, sans changer silencieusement la voix.
- **P0-B — DEV :** terminer et fiabiliser les chaînes Goal/DEV, le budget, les validations, l'évaluation et les protections.
- **P1 — Figma V2 :** lecture des frames/styles/assets, analyse visuelle, comparaison Figma ↔ Preview et validation sur un cas métier réel.
- **P2 — SelfDev V1 :** diagnostic, patchs isolés, tests et revue explicite avant toute intégration.
- **Parallèle :** vrai compagnon **iPhone**, conversations et jobs synchronisés avec le Mac, appairage sécurisé et notifications ; mémoire et données privées restent protégées.
- **V2 planifié après sécurisation :** Google Agentic OAuth & MCP Access — audit, clients standard/agentique séparés, broker central, pilote MCP lecture seule ; ne change pas les P0/P1/P2.
- **Transverse :** Daily Brief à 7 h, anticipation, proactivité non intrusive, sécurité, sauvegardes, voix et qualité d'usage au quotidien.

## Lire la roadmap complète (dans l'ordre)

1. [Vision et historique — sections 0–1](roadmap/00_vision_historique.md)
2. [V1 : les fondations et les 45 étapes historiques — section 2](roadmap/01_v1_socrle.md)
3. [V2 : historique des moteurs et chantiers — section 3](roadmap/02_v2_historique.md)
4. [État opérationnel documenté — section 4](roadmap/03_etat_operationnel.md)
5. [P0 : Cedar / GPT-Live / Realtime et Mode DEV — section 5](roadmap/04_voix_et_dev_p0.md)
6. [Figma, SelfDev, iPhone et proactivité — sections 6–9](roadmap/05_figma_selfdev_iphone_proactivite.md)
7. [Extensions V2 et intelligence/autonomie — sections 10–11](roadmap/06_extensions_v2_et_autonomie.md)
8. [V3, visions V4/V5 et arbitrages — sections 12–14](roadmap/07_v3_v5_priorites.md)
9. [Validation utilisateur et gouvernance — sections 15–16](roadmap/08_validation_gouvernance.md)
10. [Références et synthèse — section 17](roadmap/09_references.md)
11. **[P0-A : voix GPT-Live full duplex, délégation asynchrone et critères d'acceptation](roadmap/10_voice_full_duplex_gpt_live.md)**
12. **[Google Agentic OAuth & MCP Access — avenant V2 du 13/10/2026](roadmap/11_google_agentic_oauth_mcp_access.md)**

## Règles de mise à jour

La source de vérité **technique** est toujours le code et les tests réels du Mac, puis l'état du dépôt distant. La source de vérité **produit** est la dernière décision explicite. Ne pas confondre « développé », « testé », « LIMITED/SHADOW », « prêt » et « réellement validé ».

Ce commit est **documentaire uniquement** : aucun changement au runtime Noon, aucun déploiement Electron ou iOS, aucune activation de provider ou d'écriture externe. L'intégration à la branche de développement reste à effectuer après revue.
