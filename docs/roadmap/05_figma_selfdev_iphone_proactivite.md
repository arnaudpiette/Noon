## 6 — PREMIER grand test métier après DEV : FIGMA V2 (P1)

**Pourquoi maintenant :** démontrer une utilité directe dans ton rôle de directeur artistique et ta pratique du front-end. Plus probant qu’ajouter un autre moteur abstrait.

**Figma V2 READ ONLY**
1. Authentification/configuration des droits minimaux, erreurs compréhensibles, OAuth réel sur fichier accessible.
2. Recherche fichiers/projets, lecture pages, frames, composants, variants, styles, typographies, couleurs, espacements et métadonnées.
3. Export contrôlé PNG/SVG/assets et attribution exacte des sources.
4. Correspondance **Figma ↔ projet DEV ↔ Preview** sans supposer que des noms identiques garantissent un mapping parfait.
5. Rapport d’écarts explicables : composition, dimensions, typographie, responsive, couleur, images, composants, comportement accessible.
6. Proposition de corrections priorisées, possibilité d’envoyer un sous-ensemble dans Native DEV après permission.
7. Tests sur **une vraie maquette** + desktop et mobile, capture visuelle reproductible, limites et faux positifs documentés.

**Ne pas faire en V2 initiale :** écrire dans Figma, poster des commentaires, transformer chaque écran en agents autonomes, sur-promettre du « pixel-perfect » sans pipeline de comparaison mesuré. Les mutations Figma avancées attendent V3 et une approbation explicite.

**Critère P1 :** « Noon, ouvre cette frame Figma, compare-la à mon Preview, classe les différences réelles et prépare un plan de correction raisonnable. »

## 7 — DEUXIÈME grand test métier : SELFDEV V1 contrôlé (P2)

**Ambition :** Noon améliore son propre projet **en observation, proposition et préparation**, pas par auto-mutation libre.

Progression prévue :
- **SelfDev V0 — observer** : diagnostics, Bugs/Problems, performances, tests cassés, TODO/régressions, sources et confiance.
- **SelfDev V1 — conseiller et préparer** (priorité après Figma) : bug reproductible → cause/risque → plan → branche/worktree isolé → patch exact → tests/lint/build/diff → revue indépendante → proposition de merge/commit, **sans intégration automatique**.
- **SelfDev V2 — implémenter en autonomie bornée** : plusieurs itérations sous limites explicites, toujours avec sécurité et validation humaine pour effets engageants.
- **SelfDev V3+ — maintenance contrôlée** : à ne considérer qu’après preuve cumulée de sûreté, reprise, non-régression et rollback.

**Invariants :** Noon ne peut jamais modifier ses Hard Rules, élargir ses permissions, désactiver ses tests, augmenter ses budgets, lire ses secrets, auto-approuver ses actions ou effacer des données utilisateur. Pas de commit/push automatique par défaut.

**Critère P2 :** « Noon, explique ce bug réel de ton application ; propose un correctif sur copie isolée et démontre qu’il n’aggrave pas les tests et l’UX. »

## 8 — CHANTIER PARALLÈLE V2 : iPHONE COMPAGNON (non décalable en V3)

**Architecture déjà préparée mais non livrée en mobile réel :** SyncPolicy, DeviceRegistry, chiffrement Ed25519 / X25519 / AES-GCM, SyncEngine, tests loopback ; Remote Interaction/Handoff avec canaux TEXT/VOICE/MEDIA/UI_ACTION/APPROVAL_RESPONSE/JOB_CONTROL, mocks, flags SHADOW/OFF. **Ce ne sont pas une application iOS, un réseau réel ou des notifications push.**

**MVP mobile personnel :**
1. Choisir une implémentation **iOS native / compagnon léger**, sans compte SaaS multi-utilisateur.
2. Appairage manuel appareil ↔ Mac, authentification forte, permissions minimales, révocation simple et visible.
3. Transport réel sécurisé : LAN d’abord, puis relais chiffré seulement si l’usage hors maison le justifie ; aucun port public libre ni transfert des clés/tokens du Mac.
4. Conversations texte synchronisées, handoff Mac↔iPhone, contexte clair et restauration après réseau interrompu.
5. Lire Daily Brief, suggestions, agenda/états pertinents, historique utile, progression des jobs Mac et notifications autorisées.
6. Émettre des demandes **non sensibles** vers le Mac, qui reste propriétaire des connecteurs ; ne jamais transformer l’appairage en droit d’exécuter.
7. Médias sélectionnés volontairement et voix push-to-talk ensuite ; wake word permanent en arrière-plan iOS **non garanti**.
8. Données ultra-sensibles **sur le Mac uniquement** par défaut ; statut offline/stale explicite ; aucun replay de commande mutante au retour réseau.

**Critère iPhone :** démarrer une conversation sur Mac, la reprendre sur iPhone, lire le Brief et l’état d’une tâche, perdre/retrouver le réseau et révoquer l’iPhone sans fuite. Tester sur appareil physique.

## 9 — FIL TRANSVERSE À NE JAMAIS REPOUSSER : Noon quotidien, intelligent et proactif

### 9.1 Daily Brief façon ChatGPT, réellement actionnable
À **07:00 Europe/Paris**, un seul Brief consolidé :
- agenda du jour ; **3 priorités maximum** ; « à ne pas oublier » ; emails importants ; créneaux disponibles ; planning suggéré ; suggestions Noon ; **anticipation sur 7 jours** ; « à surveiller » ; ⭐ priorité proposée par Noon ; volet créatif seulement pertinent.
- Sources : Calendar, Reminders, Notes, Gmail, projets, mémoire, Execution Tracking, Git ; affiche source/horodatage/fraîcheur/indisponibilité.
- Des **actions proposées** et directement contrôlables plutôt qu’une simple compilation de faits ; respecte la pause déjeuner 12 h 30–13 h 30.

### 9.2 Proactive & Anticipation Engine — capitaliser sur l’existant
Moteur événementiel déjà documenté : normalisation → PriorityEngine → politique interruption (`IGNORE`, `STORE_FOR_BRIEF`, `SUGGEST`, `NOTIFY`, etc.) → anti-répétition → feedback → ApprovalEngine pour action engageante.

Évolutions : anticipation **7 jours** et risques de projet, préparation silencieuse, résumé « pourquoi maintenant ? », niveau de confiance, explication des sources, opportunités et conflits d’agenda, détection des tâches bloquées, suivi des décisions. **Centre d’actions/suggestions** avec accepter, rejeter, reporter, corriger, « ne plus proposer » et kill switch. **Pas de second Event Engine autonome** si le moteur existant suffit.

### 9.3 Learning Engine, Adaptive Router, modèle mental personnel
Apprendre des corrections, retours « utile », horaires, durée réelle, réussite/échec des tâches, agent/model cost-speed-quality, sans « règle apprise » secrète. Contrôle utilisateur, scopes, expiration, audit, retrait et refus des changements de sécurité. Tests A/B mesurés, pas de sélection automatique d’un modèle supérieur en coût sans amélioration prouvée.

### 9.4 Mémoire/contextes/projets durables
Mémoire générale + privée `local_only`, Focus, historique, résumé de longues conversations, Context Builder/Offloader, recherche personnelle, objectifs de moyen/long terme, budgets et suivi. Ne jamais considérer une hypothèse ou un résumé comme un fait confirmé.

### 9.5 Voix et interaction naturelle
**Priorité P0 depuis le 12/10 : Cedar primaire, Arbor cible conditionnelle, test `gpt-live-1` vs `gpt-realtime-2.1`/mini** (détail en section 5.A). Même voix sur Mac/iPhone et voies TTS/Live si supportées, interruptions naturelles, micro réel, AirPods, mode dégradé/absence de réseau et sécurité stricte des délégations. Toute voix de secours est annoncée. Simplifier les échanges vocaux sans réduire les autorisations pour les actions sensibles.

