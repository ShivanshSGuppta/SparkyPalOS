#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_URL="${SPARKYPAL_APP_URL:-https://sparkypalos.vercel.app}"
BUILD_DIR="${PROJECT_DIR}/dist/macos"
APP_DIR="${BUILD_DIR}/SparkyPalOS.app"
CONTENTS_DIR="${APP_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"
INFO_PLIST="${CONTENTS_DIR}/Info.plist"
ZIP_PATH="${PROJECT_DIR}/dist/SparkyPalOS-macOS.zip"

case "${BUILD_DIR}" in
  "${PROJECT_DIR}/dist/macos") ;;
  *) echo "Refusing to clean unexpected build directory: ${BUILD_DIR}" >&2; exit 1 ;;
esac

rm -rf "${BUILD_DIR}"
mkdir -p "${MACOS_DIR}" "${RESOURCES_DIR}" "${PROJECT_DIR}/dist"

swiftc \
  -O \
  -target arm64-apple-macosx14.0 \
  -framework Cocoa \
  -framework WebKit \
  "${PROJECT_DIR}/macos/SparkyPalOS/main.swift" \
  -o "${MACOS_DIR}/SparkyPalOS"

plutil -create xml1 "${INFO_PLIST}"
plutil -insert CFBundleName -string "SparkyPalOS" "${INFO_PLIST}"
plutil -insert CFBundleDisplayName -string "SparkyPalOS" "${INFO_PLIST}"
plutil -insert CFBundleIdentifier -string "com.sparkypal.os" "${INFO_PLIST}"
plutil -insert CFBundleVersion -string "1.0.0" "${INFO_PLIST}"
plutil -insert CFBundleShortVersionString -string "1.0.0" "${INFO_PLIST}"
plutil -insert CFBundlePackageType -string "APPL" "${INFO_PLIST}"
plutil -insert CFBundleExecutable -string "SparkyPalOS" "${INFO_PLIST}"
plutil -insert LSMinimumSystemVersion -string "14.0" "${INFO_PLIST}"
plutil -insert NSHighResolutionCapable -bool true "${INFO_PLIST}"
plutil -insert SparkyPalURL -string "${APP_URL}" "${INFO_PLIST}"

if [[ -f "${PROJECT_DIR}/assets/sparkypal-logo.svg" ]]; then
  cp "${PROJECT_DIR}/assets/sparkypal-logo.svg" "${RESOURCES_DIR}/sparkypal-logo.svg"
fi

codesign --force --deep --sign - "${APP_DIR}"
codesign --verify --deep --strict "${APP_DIR}"

rm -f "${ZIP_PATH}"
(
  cd "${BUILD_DIR}"
  COPYFILE_DISABLE=1 zip -q -r -X "${ZIP_PATH}" "SparkyPalOS.app" -x "*/._*" -x "__MACOSX/*"
)

echo "${ZIP_PATH}"
