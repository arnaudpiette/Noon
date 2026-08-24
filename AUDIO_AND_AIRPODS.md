# Audio et AirPods

Noon utilise le périphérique d’entrée choisi par macOS. Conversation Live ne démarre qu’après une action explicite. En cas de veille, verrouillage ou fermeture de session Live, les pistes audio sont arrêtées.

Pour choisir des AirPods, connectez-les dans macOS puis sélectionnez-les comme entrée/sortie système avant de lancer Conversation Live. Chromium ne permet pas toujours de forcer une sortie avec `setSinkId`; dans ce cas Noon conserve honnêtement la sortie système.
