## 12 — V3 : capacités étendues (après audit V2 réel)

### V3.1 Mobilité opérationnelle
Directions marche/vélo/voiture, alternatives, carte interactive, circulation, ETA fiable, rappel de départ, intégration agenda/Brief ; position précise seulement si consentement et sans conservation par défaut.

### V3.2 Desktop Automation Engine
APIs natives, AppleScript, Shortcuts, Accessibility et adaptateurs application par application ; plan/preview/approbation/audit, sandbox réelle si nécessaire ; aucune permission système générale accordée simplement parce que l’utilisateur possède son Mac.

### V3.3 Figma avancé
Figma ↔ Preview avec composants dynamiques, commentaires, exports/variantes et **mutations Figma uniquement après aperçu exact et autorisation individuelle**.

### V3.4 SelfDev étendu
Patchs plus grands, plusieurs étapes et corrections autonomes bornées, tests de non-régression indépendants, versionnement et rollback ; aucune auto-altération des garde-fous ni mise à jour en production sans revue.

### V3.5 Continuité Mac / iPhone étendue
Voix push-to-talk et médias, notifications temps réel, résilience des échanges sur réseaux mobiles, relais privé chiffré si nécessaire, handoff transparent du contexte (pas du flux audio WebRTC déjà actif), offline explicite. Apple Watch potentielle plus tard.

### V3.6 MediaControlSkill
Deezer : play/pause, suivant/précédent, volume, recherche/lancement si API et permissions fiables ; adaptateur optionnel de confort.

### V3.7 Optimisation locale, recherche avancée
Optimisation des stratégies, latence/énergie/prix, planification et charge ; comparer heuristiques classiques (dont OR-Tools selon pertinence) ; algorithmes *quantum-inspired* uniquement en **laboratoire indépendant** et uniquement si la mesure justifie l’essai. **Aucune promesse d’ordinateur quantique ni d’amélioration garantie.**

## 13 — V4 et V5 : anciennes visions conservées, mais GELÉES

Ces pistes étaient évoquées dans des conversations de septembre, **avant** la décision plus récente « Noon = toi + ton Mac + ton iPhone ».

- **V4 exploratoire (produit distribuable)** : installateur pour plusieurs utilisateurs indépendants, onboarding et profils différents, stabilité/support/distribution et architecture sécurisée adaptée. **GELÉ** : pas d’entreprise SaaS ni de multi-tenant à concevoir maintenant.
- **V5 exploratoire (écosystème)** : SDK ouvert à des développeurs tiers, plugins/agents/capacités externes, catalogue, permissions et compatibilité de versions. **GELÉ** : l’architecture d’agents interne appartient déjà à V1/V2 ; V5 ne doit pas être présentée comme la date de naissance du multi-agent.
- **Apple Watch / extension plateformes** : à étudier seulement après une app iPhone utile et stable.

## 14 — Priorisation canonique : ce qu’on garde, développe, gèle ou décale

| Rang / horizon | Action | Critère de sortie |
|---|---|---|
| **P0-A maintenant** | **Voix Cedar + comparaison `gpt-live-1` et `gpt-realtime-2.1`/mini** ; audit du VoiceIdentity Marin/Cedar | parole naturelle sur vrai Mac, continuité, interruptions, délégation sécurisée, tests/coûts réels ; Arbor uniquement si API officielle |
| **P0-B en parallèle** | Clore Goal Retry 4.6 et les parcours DEV/sécurité/UX manquants | un vrai cycle DEV avec preuve, contrôle, annulation et budgets |
| **P1 juste après DEV** | **Figma READ ONLY + comparaison Preview** | diagnostic d’une maquette réelle utile à une DA/frontend |
| **P2 après Figma** | **SelfDev V1 isolé et soumis à validation** | bug réel → proposition patch/test, aucune auto-intégration |
| **V2 en parallèle dès maintenant** | **iPhone compagnon** : appairage, conversations, brief, statuts/notifications | usage réel sur téléphone et révocation fonctionnelle |
| **Transverse permanent** | Brief 7 h, mémoire, proactivité, recherche interne, qualité des réponses (voix pilotée explicitement en P0-A) | fiabilité sur 7 jours et gains vérifiables |
| **V2 après P1/P2** | Dictaphone, vidéo, recherche tierce, Launcher, Mobility contrat, documents premium, Learning | chaque fonction passe un test métier bout-en-bout |
| **V3** | Figma écriture approuvée, SelfDev plus autonome, Desktop, Mobility complet, médias, iPhone avancé, optimisations | sécurité et utilité démontrées, pas de raccourci vers les permissions |
| **Gel** | SaaS, multi-utilisateur, marketplace, auto-modification libre, Quantum Lab comme priorité produit | aucun investissement tant que solo Mac+iPhone suffit |

**Ordonnancement :** la sortie DEV est une condition des tests Figma/SelfDev ; iPhone et qualité quotidienne progressent **en parallèle**, pas dans une file unique après SelfDev.

