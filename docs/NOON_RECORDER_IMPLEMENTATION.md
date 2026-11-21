# Dictaphone Noon — état de développement

Branche `feat/noon-recorder`, basée sur `v2/multi-provider`. Les fichiers de `NOON_DATA_DIR/recordings/` sont des données personnelles et restent hors dépôt.

## Parcours implémenté

- Bouton Dictaphone dans la barre latérale, capture micro explicite avec accord déclaré, pause/reprise/arrêt et indicateur dans la navigation.
- Sauvegarde progressive en fragments WebM/MP4/Ogg avec empreintes SHA-256, upload idempotent, métadonnées atomiques, liste et récupération des fragments intègres au redémarrage. Une capture interrompue se lit, mais ne reprend pas sous le même ID.
- Import audio ou vidéo MP4 (piste son uniquement), bibliothèque avec titre/projet/tags et recherche, comparaison côte à côte de deux sessions, lecteur local, transcription distante sur accord spécifique, correction versionnée, noms d'intervenants confirmés manuellement. Le mode multi-voix retourne des segments horodatés si le provider les fournit.
- Analyse distante sur accord spécifique ; chaque citation est vérifiée comme sous-chaîne de la transcription. Les points peuvent être validés ou rejetés manuellement ; aucune écriture dans Agenda/Mémoire/Goal Mode.
- Exports DOCX, XLSX, PPTX, PDF, MD et TXT ; SRT/VTT si des segments horodatés existent. Téléchargement dans le dossier choisi par le navigateur, sans écrasement silencieux géré par Noon.

## Limites à résoudre avant une livraison complète

1. Aucune validation réelle du microphone, de la capture longue, du sommeil/réveil et du bundle Electron sur macOS x64 dans cet environnement Linux. Le test HTTP emploie un fragment factice ; il ne valide pas l'audio décodable.
2. Pas de transcription live ; les segments et sous-titres exigent le mode multi-voix. Le modèle de diarisation utilisé par la compatibilité API est annoncé en fin de vie le 26 février 2027. Prévoir un adaptateur de remplacement avant cette date. L'autre mode utilise `gpt-transcribe`, qui ne fournit pas d'horodatages via cette route. Voir la documentation officielle de transcription OpenAI.
3. Transcription limitée à 10 Mo par appel. Il faut segmenter les grands médias sur des frontières audio/silences, préserver les offsets, et relier la progression au budget et à la réconciliation des appels distants.
4. La correspondance exacte entre une citation d'analyse et un segment audio n'est pas vérifiée ; l'UI offre une écoute des segments, mais l'analyse cite actuellement le texte. La comparaison entre sessions est visuelle et ne fusionne pas les décisions ; la vidéo MP4 utilise sa piste sonore uniquement, sans analyse de scènes ni extraction vidéo avancée.
5. Les exports sont des premiers fichiers éditables générés par le moteur existant ; pas encore de modèles graphiques premium, d'aperçu/édition préalable, ni de validation d'ouverture dans Word/Excel/PowerPoint sur Mac. Les corrections du verbatim retirent les anciens segments, speakers et analyses pour éviter une provenance périmée.
6. Les médias locaux ne sont pas chiffrés par ce lot et ne sont pas enregistrés dans le système de sauvegarde Lifecycle actuel (qui ne sait copier que des fichiers). Rattacher un backup de répertoire validé avant de promettre une restauration. La suppression enlève le dossier local ; copies externes, backups et données déjà envoyées aux providers ne sont pas contrôlables ici.
7. Pas de rattachement canonique aux entités Projet de Noon, politique de rétention, contrôle explicite d'espace disque, suivi du coût par job, état `UNKNOWN` après timeout facturable ou job reprenable. Aucun accès autorisé au son système.

## Validation effectuée

- Tests de stockage : persistance après redémarrage, doublon, conflit, corruption, révision, citations, invalidation, confirmation des noms.
- Vérification HTTP locale : création, fragment, arrêt, lecture, correction, export DOCX et suppression.
- `node --check` sur les fichiers modifiés, `git diff --check`, `npm run lint`, `npm test` (voir sortie de la campagne actuelle).

**Ne pas activer comme fonctionnalité complète ou fiable pour des réunions importantes avant tests réels sur le Mac et résolution des limites 2, 3 et 6.**
