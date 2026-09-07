# Noon V1 — contrat de capacités

Taxonomie : `OPERATIONAL`, `OPERATIONAL_DEGRADED`, `PARTIAL`, `PREPARED`, `EXPERIMENTAL`, `DISABLED`, `NOT_IMPLEMENTED`, `BLOCKED`.

| Capacité | Owner | Statut | Preuve | Packagée | Offline | Limites / sécurité |
|---|---|---:|---|---|---|---|
| Moteurs mémoire/règles/contexte | MemoryEngine / HardRules / ContextBuilder | OPERATIONAL | cycle SQLite chiffré réel : candidat, correction, oubli et réouverture ; tests d'intégration | NOT_VERIFIED | oui | contexte distant minimisé ; UI packagée non vérifiée |
| Approbation et exécution transactionnelle | ApprovalEngine / TransactionalExecution | OPERATIONAL | tests anti-rejeu, stale, reprise | NOT_VERIFIED | oui | mutations exactes et one-shot |
| Artefacts MD/HTML/PDF/DOCX/XLSX/PPTX/PNG/RTF | ArtifactEngine | OPERATIONAL | génération/validation/versionnement testés | NOT_VERIFIED | oui hors génération modèle | preview et racines autorisées |
| Workspace et isolation | WorkspaceEngine | OPERATIONAL | tests SQLite, homonymes, fuite inter-workspace | NOT_VERIFIED | oui | Focus legacy adapté |
| Chat texte complet | NoonOrchestrator | PARTIAL | API OpenAI live et streaming vérifiés, continuité après restart vérifiée | NOT_VERIFIED | réponses déterministes seulement | renderer et chat packagé non validés |
| Voix locale complète | VoiceIdentity + renderer | PARTIAL | STT/TTS OpenAI réels sur audio artificiel ; parité/local-only automatisés | STARTUP_ONLY | non : STT, raisonnement et TTS sont distants | micro, audio audible, WebRTC/TCC/wake word réels non validés |
| Recherche personnelle | PersonalSearchEngine | PARTIAL | tests adaptateurs et isolation | NOT_VERIFIED | oui | flag historique `search.unified` OFF à rationaliser |
| Recherche Web | PublicResearchEngine | PARTIAL | tests cache/fraîcheur/injection | NOT_VERIFIED | cache seulement | aucun Web live pendant l’audit |
| Multimodal | MultimodalEngine | PARTIAL | image/PDF/audio simulés | NOT_VERIFIED | intake local | analyse distante non testée live |
| Gmail | connecteur Gmail | PARTIAL | tests mocks read/draft/send | NOT_VERIFIED | non | OAuth/réseau réel non testés ; envoi soumis à policy |
| Calendar | connecteur Calendar | PARTIAL | tests mocks + planning | NOT_VERIFIED | non | OAuth/provider/Myrtille réels non testés |
| Notes / Reminders | connecteurs Apple | PARTIAL | lecture réelle du 05/09/2026 confirmée par state + service packagé : 50 éléments Notes, 5 rappels | READ_OBSERVED_OLD_BUNDLE | macOS | refus de permission, exhaustivité et écritures non validés ; voir P1_2_P1_3_REAL_VALIDATION.md |
| GitHub / Figma | connecteurs | PARTIAL | tests locaux/config | NOT_VERIFIED | git local partiel | auth distante non testée |
| Daily Brief | DailyBriefEngine | PARTIAL | logique, DST/catch-up testés | NOT_VERIFIED | partiel | scheduler 07:00 réel non observé |
| Planning / priorité / suivi / revue | moteurs canoniques | OPERATIONAL_DEGRADED | suites déterministes | NOT_VERIFIED | oui | sources distantes peuvent être indisponibles |
| Goals / Portfolio / Decision | moteurs dédiés | EXPERIMENTAL | suites unitaires vertes | NOT_VERIFIED | oui | flags LIMITED/SHADOW/OFF |
| Proactivité / notifications | moteurs dédiés | EXPERIMENTAL | dédup/cooldown/policy testés | NOT_VERIFIED | oui in-app | macOS réel et multi-canal non validés |
| Jobs background | BackgroundJobEngine | EXPERIMENTAL | persistance/reprise/cancel testés | NOT_VERIFIED | oui | flag SHADOW |
| Offline runtime | LocalIntelligenceRuntime | EXPERIMENTAL | scénarios local/degraded testés | NOT_VERIFIED | oui | modèle local OFF |
| Extensions SDK interne | ExtensionRegistry | EXPERIMENTAL | permissions/crash/bypass testés | NOT_VERIFIED | oui | extensions externes OFF |
| Control Center | ControlCenterService | PARTIAL | read models/routes/tests | NOT_VERIFIED | oui | validation visuelle packagée absente |
| Sync multi-appareils | SyncEngine | PREPARED | contrats/tests simulés | non | n/a | SHADOW, aucun transport production |
| Interaction distante/mobile | RemoteInteractionEngine | PREPARED | contrats/tests simulés | non | non | SHADOW/OFF, aucun produit mobile |
| Contexte ambiant | AmbientContextEngine | EXPERIMENTAL | OFF/minimal/expiry testés | NOT_VERIFIED | oui | aucune capture passive ; SHADOW |
| Modèle local | LocalModelAdapter | DISABLED | contrat/fallback testé | non | oui si configuré | flag OFF, aucun modèle requis |
| Marketplace extensions | Extension SDK | DISABLED | garde de permission testée | non | n/a | extensions externes OFF |
| Auto-update production | — | NOT_IMPLEMENTED | — | non | non | volontairement hors V1 actuelle |
| Build macOS x64 | Electron Forge | PARTIAL | build + vérification statique + smoke startup réel | oui | oui | UI/micro non validés, notarisation absente |
| Build macOS arm64 | Electron Forge | BLOCKED | dépendance native arm64 absente | non | n/a | à produire sur toolchain arm64 |

## Flags V1

- `ON`: routeur modèles, recherche publique, multimodal unifié, SDK interne, Control Center.
- `LIMITED`: PDF hybride, partage explicite, sensibilité décision, goals, progression, portfolio/capacité, coalescing, runtime offline.
- `SHADOW`: délégation, jobs, sync, remote, contexte ambiant, décision, surcharge, notifications.
- `OFF`: recherche mixte, remote mutations/média/voix, capture écran, modèle local, extensions externes, historiques/scénarios avancés.

Une capacité `SHADOW` ne produit aucun effet externe et ne doit jamais être présentée comme opérationnelle.
