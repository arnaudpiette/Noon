## 18 — Google Agentic OAuth & MCP Access (avenant V2, 13 octobre 2026)

**Statut : PLANIFIÉ / NON IMPLÉMENTÉ.** Évolution transverse de Noon Electron/macOS, liée à la [documentation officielle Google sur les clients OAuth pour agents IA](https://support.google.com/cloud/answer/15549257).

### Décision produit et portée

Google propose la case **« Use this client for an AI-powered agent »** pour les clients OAuth 2.0 représentant des agents qui récupèrent des informations ou agissent pour un utilisateur. Lorsqu'une application propose à la fois des fonctionnalités classiques directement pilotées par une personne et des workflows agentiques, Google demande **deux IDs clients OAuth séparés** : standard pour les interactions classiques, *agentic* pour agents/outils/MCP. Certains endpoints Google Workspace MCP n'acceptent que des clients agentiques.

Ce marquage **ne donne aucun scope ni privilège supplémentaire**. Consentement utilisateur, règles OAuth et vérification d'application restent nécessaires. Ne pas confondre identité OAuth et permission d'exécution Noon. Un **client agentique par type de workflow**, pas un client par agent interne.

**Aucune refonte des orchestrateurs ni adoption de Gemini/Agent Engine imposée.** Noon reste l'unique interlocuteur ; les agents internes n'accèdent jamais directement aux jetons.

### Architecture cible (conceptuelle, non attestée comme implémentée)

```text
Noon Orchestrator
 ├── Interactions directes → client OAuth standard ─┐
 └── Agents / Goal Mode / Daily Brief → OAuth agentic ┤
                                                     ▼
               Google Access Broker / Tool Broker central
                  Permissions et approbations existantes
                  Scopes minimaux, identité par workflow
                  Tokens isolés, expiration/révocation
                  Audit expurgé, budgets et contrôle de réseau
                                ▼
                  API Google REST + pilote Workspace MCP
                                ▼
                       Gmail / Calendar / Drive
```

Tenir compte du statut **client public** de l'application desktop Electron : utiliser un flux OAuth natif avec PKCE et redirection sûre ; un `client_secret` embarqué n'est pas un secret. Stocker les jetons dans le stockage sécurisé macOS/Electron, jamais dans la mémoire fournie aux modèles. Respecter `local_only`, la distinction lecture/écriture et les permissions explicites.

### Découpage proposé

1. **G0 Audit en lecture seule.** Recenser clients, flux, scopes, usages Gmail/Calendar/Drive, renouvellement/révocation, stockage de jetons et capacités déjà disponibles. Ne pas changer de credentials avant audit.
2. **G1 Double profil OAuth.** Standard pour les actions directes ; agentic pour les tâches d'agents, outils et MCP. Prévoir consentement distinct si nécessaire, sans casser les connexions actuelles.
3. **G2 Google Access Broker.** Étendre le Tool Broker et le Permission/Intervention Engine *existants*, sans duplicata ; profils, scopes minimaux, contrôle par action, erreurs honnêtes (`DENIED`, `EXPIRED`, `UNAVAILABLE`), logs sans secrets, pas de tokens distribués aux sous-agents.
4. **G3 MCP officiel en pilote.** Vérifier l'accès réel et le statut des services Workspace MCP au moment des tests ; évaluer Gmail et Calendar en **lecture seule**, Drive ensuite si utile. Mesurer coût, latence, fiabilité, sécurité. Garder les intégrations REST existantes et un repli contrôlé.
5. **G4 Raccordement produit.** Brancher progressivement le Daily Brief enrichi, Goal Mode et la délégation multi-agents ; jamais d'autonomie qui élargit les droits accordés. Validation humaine pour actions engageantes.
6. **G5 Tests d'acceptation.** Client standard interdit là où le client agentic est exigé ; client agentic sans scope refusé ; expiration/révocation ; `local_only` ; injection de prompt via e-mail/document ; impossibilité de contourner autorisation, de divulguer jetons et de doubler une action ; smoke en Electron packagé.

### Placement dans la roadmap et exclusions

- **Ordre :** Sandbox V1 → Intervention/Permission Engine vérifié → Goal/DEV selon la tranche active → audit et intégration Google agentique. G0 peut être préparé en lecture seule en parallèle, sans perturber la tranche active.
- **Priorités préservées :** P0 voix/DEV, P1 Figma, P2 SelfDev, compagnon iPhone en parallèle, Daily Brief transverse. Le chantier reste planifié, pas « terminé ».
- **Non-objectifs :** pas de remplacement immédiat des API REST par MCP, pas de framework Google imposé, pas de client OAuth par agent, pas d'écriture Gmail/Calendar/Drive implicite, pas de modification runtime sur la base du seul document.
- **Références conversationnelles :** « Projet NOON #Terminal 04 » pour exécution/validation ; « Projet NOON #2 » pour roadmap et décisions transversales. Les deux doivent conserver cette décision sans devancer les chantiers prioritaires.

**Source :** https://support.google.com/cloud/answer/15549257 — section « Configure OAuth Clients for AI Agents » ; vérifier les exigences Google et l'accès MCP à la date de l'implémentation.
