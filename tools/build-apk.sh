#!/usr/bin/env bash
# Builds the Android APK without Gradle, using only the Android SDK build-tools.
# Usage: tools/build-apk.sh            (expects web build in web/dist via `npm run build`)
# Env:   ANDROID_HOME (default /opt/android-sdk), BUILD_TOOLS (default 35.0.0), PLATFORM (default android-35)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/opt/android-sdk}}"
BT_VER="${BUILD_TOOLS:-35.0.0}"
PLATFORM="${PLATFORM:-android-35}"
BT="$SDK/build-tools/$BT_VER"
ANDROID_JAR="$SDK/platforms/$PLATFORM/android.jar"
APP="$ROOT/android/app/src/main"
OUT="$ROOT/build/android"
DIST="$ROOT/dist"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0}"
KEYSTORE="$ROOT/android/dreamcore.keystore"
KS_PASS="${KS_PASS:-dreamcore}"

for f in "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner" "$ANDROID_JAR"; do
  [ -e "$f" ] || { echo "Missing $f (set ANDROID_HOME / BUILD_TOOLS / PLATFORM)"; exit 1; }
done
[ -f "$ROOT/web/dist/index.html" ] || { echo "web/dist missing: run 'npm run build' first"; exit 1; }

rm -rf "$OUT" && mkdir -p "$OUT"/{res,gen,classes,dex,assets} "$DIST"

echo "==> assets"
cp -r "$ROOT/web/dist/." "$OUT/assets/"

echo "==> aapt2 compile"
"$BT/aapt2" compile --dir "$APP/res" -o "$OUT/res/res.zip"

echo "==> aapt2 link"
"$BT/aapt2" link -o "$OUT/unsigned.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  --java "$OUT/gen" \
  -A "$OUT/assets" \
  --min-sdk-version 24 --target-sdk-version 35 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -0 mp3 -0 ogg -0 png -0 jpg \
  "$OUT/res/res.zip"

echo "==> javac"
find "$APP/java" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -nowarn -encoding UTF-8 --release 11 -classpath "$ANDROID_JAR" -d "$OUT/classes" @"$OUT/sources.txt" 2>&1 | grep -v '^Picked up' || true
[ -n "$(find "$OUT/classes" -name '*.class' | head -1)" ] || { echo "javac failed"; exit 1; }

echo "==> d8"
"$BT/d8" --release --min-api 24 --lib "$ANDROID_JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')

echo "==> package"
(cd "$OUT/dex" && zip -q -j "$OUT/unsigned.apk" classes.dex)
"$BT/zipalign" -p -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

if [ ! -f "$KEYSTORE" ]; then
  echo "==> generating keystore"
  keytool -genkeypair -v -keystore "$KEYSTORE" -alias dreamcore -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" -dname "CN=Dreamcore Vibe, O=Dreamcore, C=RU" 2>&1 | grep -v '^Picked up' || true
fi

echo "==> sign"
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias dreamcore --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "$DIST/DreamcoreVibe.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify "$DIST/DreamcoreVibe.apk"
ls -lh "$DIST/DreamcoreVibe.apk"
echo "APK ready: $DIST/DreamcoreVibe.apk"
