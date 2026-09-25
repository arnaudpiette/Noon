#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/scripts/native/noon-reminders-helper.swift"
OUT="$ROOT/resources/native/noon-reminders-helper"

mkdir -p "$(dirname "$OUT")"

if [ -x "$OUT" ] && [ "$OUT" -nt "$SRC" ]; then
  echo "Noon Reminders helper already up to date."
  exit 0
fi

echo "Building Noon Reminders EventKit helper..."

xcrun swiftc -O "$SRC" -o "$OUT"

chmod +x "$OUT"

echo "Built: $OUT"
