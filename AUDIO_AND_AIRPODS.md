# Audio et AirPods

Noon permet de sélectionner un périphérique d’entrée et une sortie audio dans ses réglages. Sans sélection explicite, il utilise les périphériques choisis par macOS. Conversation Live ne démarre qu’après une action explicite. En cas de veille, verrouillage ou fermeture de session Live, les pistes audio sont arrêtées.

Pour choisir des AirPods, connectez-les dans macOS puis sélectionnez-les dans les réglages audio de Noon avant de lancer Conversation Live. La liste est actualisée automatiquement. Si Chromium ne peut pas appliquer la sortie avec `setSinkId`, Noon conserve la sortie système et l’indique dans l’interface.

## Dictaphone : critères de prise en charge

Le Dictaphone prévu utilisera indépendamment l'entrée et la sortie audio choisies : microphone et écoute sur casque Bluetooth, micro jack lorsqu'il est exposé par macOS, ou micro intégré du Mac avec sortie jack/Bluetooth. Un casque jack sans micro reste utilisable pour l'écoute, avec sélection explicite d'une autre entrée. Une entrée sélectionnée qui disparaît ne doit pas être remplacée silencieusement par une autre.

Si macOS ne détecte aucun micro, Noon indiquera que le micro interne du Mac est peut-être introuvable et proposera les réglages Son > Entrée ou un micro externe. Une erreur d'autorisation, un périphérique absent et un flux ouvert sans signal sont trois diagnostics distincts ; un flux silencieux ne prouve pas une panne matérielle. En cas de déconnexion pendant une capture longue, préserver les segments valides, marquer la coupure puis demander une reprise contrôlée. Vérifier jack, Bluetooth, micro intégré et sorties combinées dans l'application packagée sur le Mac Intel.

Le correctif initial de cette branche protège la capture vocale courte déjà présente : il conserve l'entrée explicitement choisie lorsqu'elle disparaît, évite sa substitution silencieuse, signale sa perte et n'envoie pas d'audio incomplet à la transcription. La capture longue du Dictaphone, ses segments durables et son interface restent à développer.
