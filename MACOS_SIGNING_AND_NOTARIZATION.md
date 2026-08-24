# Signature et notarisation macOS

Le build local x64 reste non signé tant qu’aucune identité Apple n’est configurée. Ne placez jamais d’identifiant dans le dépôt.

Variables prévues : `APPLE_SIGN_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`. Lorsque toutes les informations sont disponibles, Forge active le hardened runtime, les entitlements et `notarytool`.

Contrôles après distribution :

```sh
codesign --verify --deep --strict --verbose=2 "Noon.app"
spctl --assess --type execute --verbose=4 "Noon.app"
xcrun stapler validate "Noon.app"
```

Ne lancez jamais la notarisation sans identifiants complets.
