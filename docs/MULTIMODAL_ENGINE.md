# Moteur multimodal de Noon

Noon centralise l’analyse des images, captures d’écran, PDF et fichiers audio dans `services/multimodal/`. Le moteur transforme chaque entrée en `MediaAsset`, vérifie son MIME et sa signature, calcule une empreinte SHA-256, choisit une stratégie indépendante du routeur de modèle, puis produit un paquet de preuves traçable.

## Flux

1. `media-intake-service` contrôle la source, les racines autorisées, la taille et la signature réelle.
2. `multimodal-engine` inspecte paresseusement le média et classe les PDF en texte natif, scanné, hybride ou inconnu.
3. `media-strategy-selector` sélectionne texte natif, vision/OCR ou transcription.
4. `openai-media-analyzer` envoie seulement le média nécessaire avec `store: false` et sans outil activé.
5. Les résultats deviennent des preuves structurées contenant l’asset, la page ou région éventuelle, la méthode d’extraction, la confiance et la distinction observation/inférence.
6. Le cache évite une seconde analyse lorsque l’empreinte, la stratégie, la version et l’intention sont identiques.

## Sécurité et vie privée

- Un média `local_only` n’est jamais envoyé à un fournisseur distant.
- Le contenu extrait est non fiable et ne devient jamais une instruction système.
- Les chemins doivent rester dans les racines locales autorisées, y compris après résolution des liens symboliques.
- Les données binaires restent en mémoire le temps de la session et ne sont pas copiées dans SQLite ou les journaux.
- Les journaux utilisent uniquement des identifiants, types, tailles, durées et états.
- Les vidéos sont explicitement `UNSUPPORTED`; aucune analyse fictive n’est produite.

## Limites actuelles

- L’extraction PDF native détaillée repose encore sur l’analyse de document du fournisseur lorsque nécessaire; la sélection page par page pourra être raffinée.
- La transcription n’expose des timestamps que si le fournisseur en retourne réellement.
- Il n’existe ni diarisation inventée, ni analyse des sons non vocaux.
- Le registre en mémoire est lié à la session du serveur; les preuves utiles sont injectées dans la conversation et indexées par workspace sans persister les binaires.

## Vérification

Exécuter `npm test`, `npm run eval:multimodal`, `npm run eval:critical` et `npm run build`.
