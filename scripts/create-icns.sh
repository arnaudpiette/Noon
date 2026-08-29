#!/bin/sh
# Construit le fichier .icns macOS depuis l’image PNG source de l’application.
set -eu

SOURCE_PNG="${1:-build/icon-1024.png}"
ICONSET="build/Noon.iconset"

if [ ! -f "$SOURCE_PNG" ]; then
  echo "Placez l’icône Noon validée (PNG 1024 × 1024) dans build/icon-1024.png." >&2
  exit 1
fi

mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$SOURCE_PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$SOURCE_PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o build/Noon.icns
echo "Icône créée : build/Noon.icns"
