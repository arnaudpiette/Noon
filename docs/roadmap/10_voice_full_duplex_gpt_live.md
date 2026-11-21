# P0-A — Noon Voice Full Duplex (GPT-Live)

**Statut : SPECIFICATION / NON IMPLEMENTE.** Date : 12 octobre 2026. Cette tranche complète la roadmap, sans activer ni déployer une session vocale réelle.

## Objectif produit
Noon écoute pendant qu'il parle, laisse l'utilisateur l'interrompre, ne coupe pas les fins de phrase et évite les réponses inutiles au bruit. Pendant une tâche longue, il continue à converser et peut annoncer un progrès vérifié ; les actions demeurent encadrées par le backend Noon. Même identité vocale sur Mac et iPhone.

## État réellement connu
- La branche `v2/multi-provider` porte déjà `services/voice/voice-identity.js` avec Cedar canonique, Arbor future et **aucun fallback vocal implicite**. Ne pas réintroduire Marin par défaut. La doc historique `docs/VOICE_IDENTITY.md` est obsolète à ce sujet et doit être auditée, pas considérée comme source de vérité.
- Le pipeline Live existant et ses tests restent à auditer sur le HEAD local ; ne pas déclarer GPT-Live fonctionnel dans Noon.
- **API OpenAI :** `gpt-live-1` est documenté, full duplex et compatible avec la délégation client, sous réserve d'accès API au projet et de tests réels. `gpt-realtime-2.1` reste candidat de comparaison/fallback validé, sans bascule silencieuse.
- Référence architecture : texte fourni par l'utilisateur sur GPT-Live (inférence continue, séparation audio/raisonnement, délégation asynchrone, transcriptions provisoires/finales, WebRTC). Les optimisations internes OpenAI (instances, WARP, Instant Connect) ne sont **pas** à réimplémenter dans Noon.

## Architecture cible : réutiliser l'existant
```text
Mac Electron (puis iPhone) : micro / haut-parleur
  <-> WebRTC GPT-Live-1 avec voix Cedar : écoute + parole simultanées
           | événements audio, transcription provisoire, interruptions
           v
  Noon Live Session Adapter (nouvel adaptateur, pas nouvel orchestrateur)
           | client delegation, requestId, revision, cancellation
           v
  NoonOrchestrator -> ContextBuilder / ModelRouter -> agents/Skills
                   -> OperationalSecurityPolicy -> ApprovalEngine
                   -> TransactionalExecution -> résultat vérifié
           | évènements de progression filtrés et résultat concis
           v
  GPT-Live-1 peut continuer de parler ou restituer le résultat
```

Le flux audio ne doit jamais être bloqué par les appels de code, Git, Gmail, Calendar ou recherche. Utiliser `delegation: {type:'client'}` pour garder le choix du modèle et les règles chez Noon. Le serveur Node détient la clé API et traite les outils ; pas de fonction privilégiée directement exposée au modèle vocal.

## Contrats indispensables
1. **Session** : une session Live et une identité vocale contrôlées ; connexion WebRTC, fermeture propre, reprise par nouvelle session si nécessaire. `store:false` par défaut.
2. **Dialogue continu** : transcription utilisateur et assistant en cours affichée comme provisoire ; conversation finale persistée seulement après stabilisation. La parole entendue/émise est distincte du texte généré et des états de tâche.
3. **Interruption** : si l'utilisateur corrige une date/une cible, incrémenter `requestRevision`, invalider toute approbation devenue inexacte et empêcher les résultats périmés de déclencher une action. Ne pas rejouer ni annuler fictivement une mutation externe déjà engagée.
4. **Délégation** : un `delegationId` relie les demandes au vrai backend ; progressions factuelles via `session.thinking.append`, résultats destinés à la parole via `session.commentary.append` (respecter les limites de taille de l'API) ; aucun succès annoncé avant confirmation par Noon.
5. **Attention** : distinguer parole adressée à Noon, conversation ambiante, bruit et silence. Une réponse muette est un comportement valide. Ne pas parler à chaque micro-pause.
6. **Sécurité** : ni une validation orale supposée, ni une transcription provisoire, ni le modèle Live n'accordent de permission. Les actions sensibles conservent la confirmation utilisateur explicite et le workflow existant. En `local_only`, aucun audio n'est envoyé au cloud ; mode vocal local limité ou indisponibilité affichée clairement.
7. **Confidentialité / budget** : aucun fichier audio brut conservé par défaut ; jamais de texte/audio sensible dans la télémétrie ; minutes facturées, coûts backend séparés et budget session borné.
8. **Mobile** : réutiliser les mêmes contrats côté iPhone ; le Mac reste autorité des actions et secrets ; une session vocale doit être reprise, pas transférée comme un flux audio continu garanti.

## Développement en tranches (sans déranger DEV)
- **P0-A.1 Audit** : cartographier l'audio actuel, la voix Cedar canonique, les handlers et les limites Electron. Vérifier l'accès du projet API à `gpt-live-1` sur une session non sensible.
- **P0-A.2 Spike** : une session Mac WebRTC, Cedar, capture/lecture et arrêt contrôlé, sous feature flag `voice.live.full_duplex` = OFF par défaut. Mesurer la latence et les interruptions.
- **P0-A.3 Délégation client** : connecter uniquement l'orchestrateur, son contexte borné et les résultats vérifiés, sans contournement des permissions.
- **P0-A.4 Robustesse** : assembler transcriptions provisoires/finales, révisions, correction en cours de tâche, relecture de progrès et mode silence ; tester les pannes/réconnexions.
- **P0-A.5 Comparatif** : comparer avec Realtime-2.1 et pipeline actuel sur scénario égal, valider coûts, qualité et latences P50/P95 ; laisser les flags OFF/LIMITED jusqu'à validation réelle.
- **V2 iPhone** : porter le client audio quand Remote Interaction et transport sécurisé sont réellement prêts.

## Scénarios d'acceptation
- Interrompre Noon lorsqu'il parle et le voir adapter la réponse sans écho ni double action.
- Dire « attends » pendant un diagnostic DEV : l'audio reste fluide, la tâche reste contrôlable.
- Modifier une consigne pendant une recherche : un résultat obsolète ne déclenche ni annonce de succès ni mutation.
- Présenter un résultat vérifié seulement après la fin réelle d'un outil ; refuser une action sans approbation.
- Reprendre après coupure réseau sans exposer de secret ni rejouer une action.
- Conserver Cedar sur toutes les voies compatibles et ne pas substituer Marin automatiquement.
- Mesurer TTFA, latence d'interruption, stabilité longue session, perte de parole, coût et mémoire Electron.

## Documentation officielle
- https://developers.openai.com/api/docs/models/gpt-live-1
- https://developers.openai.com/api/docs/guides/live
- https://developers.openai.com/api/docs/guides/live-delegation
- https://developers.openai.com/api/docs/guides/live-migration
- https://developers.openai.com/api/docs/guides/live-conversations

**Décision :** P0-A prioritaire, mais non déclaré livré tant que macOS réel, API, sécurité et tests ne sont pas validés.
