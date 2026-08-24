#!/bin/sh
set -eu

SOURCE_APP="${1:-$(pwd)/out/Noon-darwin-x64/Noon.app}"
DESTINATION="/Applications/Noon.app"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/Applications/Noon-backup-${STAMP}.app"

if [ ! -d "$SOURCE_APP" ]; then
  echo "Application construite introuvable : $SOURCE_APP" >&2
  exit 1
fi

echo "Source : $SOURCE_APP"
echo "Destination : $DESTINATION"
if [ -d "$DESTINATION" ]; then
  echo "La version existante sera sauvegardée dans : $BACKUP"
fi
printf "Installer cette version de Noon ? [o/N] "
read -r ANSWER
case "$ANSWER" in o|O|oui|OUI) ;; *) echo "Installation annulée."; exit 0 ;; esac

osascript -e 'tell application "Noon" to quit' 2>/dev/null || true
sleep 2

if [ -d "$DESTINATION" ]; then
  mv "$DESTINATION" "$BACKUP"
fi

if ! ditto "$SOURCE_APP" "$DESTINATION"; then
  echo "Installation impossible." >&2
  if [ -d "$BACKUP" ] && [ ! -d "$DESTINATION" ]; then
    mv "$BACKUP" "$DESTINATION"
    echo "Ancienne version restaurée."
  fi
  exit 1
fi

open "$DESTINATION"
echo "Noon installé. Les données de ~/Library/Application Support/Noon n’ont pas été modifiées."
