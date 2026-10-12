## 10 — NOUVEAUX MODULES V2 après preuve Figma/SelfDev

### V2-Dictaphone & Meeting Intelligence
- Entrée dédiée « **Dictaphone** » en sidebar, fenêtre conversation spécifique, bouton démarrer/arrêter, transcription visible **en direct**.
- Mono/multi-intervenants, *diarisation* avec étiquettes Personne 1/2 si robuste, correction manuelle et repères temporels ; ne pas confondre voix et identité réelle.
- Bouton **« Fin de la transcription »** ; conserver intact le verbatim original, lancer séparément l’analyse.
- Produire un **DOCX premium** via Artifact Engine : résumé, contexte, thèmes, décisions, actions, responsables/échéances **seulement explicites**, questions, points sensibles/incertains, source et horodatages. Aperçu avant enregistrement.
- Consentement/information des participants, conservation locale, suppression, interruption/reprise en cas de panne, mode privé.

### V2-Transcription de vidéo locale / YouTube
- Import vidéo locale autorisée, extraction audio, réutilisation de la pipeline dictaphone, transcription horodatée, chapitrage, résumé et analyse.
- YouTube : utiliser uniquement sous-titres, transcriptions et médias auxquels Noon est légitimement autorisé à accéder ; ne pas promettre téléchargement libre de toutes les vidéos.
- Permettre synthèse/sources avec liens temporels et export DOCX/PDF après vérification.

### V2-Web Research & Knowledge
- Capitaliser sur PublicResearchEngine / PersonalSearchEngine / MultiSourceSynthesisEngine, provenance et synthèse.
- Adaptateurs optionnels : **Perplexity** (recherche sourcée), **Firecrawl** (extraction structurée de pages autorisées), **Context7** *si c’est bien ce qui était visé par « Context »* (documentation de bibliothèques versionnée).
- Cache, date, citations, URL, détecteur de prompt injection, rate limits, budget, source fiable et frontière `local_only`. Ne pas envoyer les contenus privés à un crawler cloud sans permission.
- **Document Intelligence** : lecture PDF/DOCX/etc., comparaison multi-documents, analyse et synthèse, moteur de preuves commun ; intérêt éventuel pour **DuckDB/Polars** sur lots tabulaires.
- **Open-Source Lab / Hybrid Search / Code Brain** : introduire uniquement lorsque cas d’usage et benchmarks démontrent l’intérêt (embeddings locaux, index hybride, graph codebase, extracteurs spécialisés).

### V2-Actions pratiques et connexions
- **Local App Launcher** : détecter `/Applications` et `~/Applications`, ouvrir/activer une app, ouvrir fichier/URL dans l’app consentie ; **pas de shell libre**.
- **Mobility V2 contrat** : `WALK/BIKE/CAR`, départ/destination, ETA/distance si fournisseur, heure de départ suggérée, hooks Agenda/Planning/Brief, UI de carte prévue, localisation précise non stockée par défaut.
- **Figma Read Only** déjà priorisé P1 ; les mutations restent après approbation en V3.
- **Documents bureautiques** : rendu Word/Excel/PowerPoint/PDF de qualité, previews, versionnage, références, styles réutilisables ; l’Artifact Engine existe déjà.
- **Intégrations** : Gmail/Calendar/Drive/Contacts/Notes/Rappels/GitHub/Figma et services futurs selon un registre de permissions central, sans duplication de propriétaire.

### V2-Google Agentic OAuth & MCP Access (avenant du 13/10/2026)
- Google distingue **client OAuth standard** (interaction directe) et **client OAuth déclaré agentique** (agents, outils, MCP) ; certains endpoints Workspace MCP exigent le second sans lui donner de privilèges supplémentaires.
- **Planifié, non implémenté** : audit OAuth Gmail/Calendar/Drive, séparation par workflow, Google Access Broker raccordé aux permissions existantes, pilote MCP officiel **lecture seule**, conservation des API REST actuelles.
- Daily Brief, Goal Mode et agents internes passeront par le broker, sans accès direct aux tokens ni droits élargis. **Sandbox et Intervention/Permission Engine d'abord.**
- Voir la [spécification complète et les tests d'acceptation](11_google_agentic_oauth_mcp_access.md).

## 11 — Autonomie, raisonnement, décision et supervision (moteurs transverses)

**Reasoning Orchestrator / Task Engine** : comprendre un problème, le décomposer, séquencer le travail et coordonner les modèles/outils ; utiliser l’unique orchestrateur canonique et les services existants.

**Goal Mode** : objectif explicite + résultats vérifiables + contraintes de budget/temps/étapes/retries/providers/shell/réseau/Git ; plan puis itérations ; arrêt quand objectif prouvé, limites atteintes ou autorisation nécessaire. Un but **n’est jamais une permission**.

**Uncertainty & Decision Engine** : plusieurs hypothèses, preuves et contradicteurs, fraîcheur, couverture, contradictions, arbitrage coût/valeur de l’information, suggestions de vérification. Le moteur produit un **avis** et des preuves, pas un droit d’exécution.

**Multi-agent adaptatif** : agents spécialisés (code, review, sécurité, DA, recherche) à la demande ; appels limités par budgets ; un agent ne valide pas seul ses propres changements sensibles. **Noon reste seul interlocuteur**.

**Progress & Observability** : affichage de l’état de chaque longue tâche, durées, sources, coûts, propriétaire, validations, raison des échecs/attentes et bouton annuler ; audit expurgé. Pas de traces de raisonnement privées ni de secrets.

**Evidence & Provenance** : toute recommandation importante sépare `vérifié / détecté / supposé / non connu` et peut renvoyer à une preuve, une version et un horodatage. Ne pas multiplier les moteurs de preuves concurrents.

