#!/bin/sh
# Builds and signs apps/desktop/release/mac-arm64/Print Tally.app (docs/build.md). A local build by default;
# PRINTTALLY_RELEASE=1 for a release build, which CI then notarizes (docs/release.md).
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
DESKTOP="$ROOT/apps/desktop"

RELEASE=${PRINTTALLY_RELEASE:-0}
VERSION=${PRINTTALLY_VERSION:-$(bun -p "require('$DESKTOP/package.json').version")}
KIND=release
if [ "$RELEASE" != "1" ]; then
    KIND=local
    BUILD_LABEL=$(git -C "$ROOT" rev-parse --short=8 HEAD)
    if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=normal)" ]; then
        BUILD_LABEL="$BUILD_LABEL-dirty"
    fi
    BUILD_STAMP=$(date -u +%Y%m%dT%H%M%SZ)
    VERSION="$VERSION-local+$BUILD_LABEL.$BUILD_STAMP"
fi

# shellcheck source=scripts/signing.sh
. "$ROOT/scripts/signing.sh"
if [ "$IDENTITY" = "-" ]; then
    printf '%s\n' \
        'WARNING: Print Tally.app will be ad-hoc signed.' \
        'It only opens on this Mac.' >&2
fi

# A release build runs under the hardened runtime with a secure timestamp, as notarization requires.
# The server's JIT entitlements (build/entitlements.mac.inherit.plist) apply either way.
if [ "$RELEASE" = "1" ]; then
    set -- -c.mac.hardenedRuntime=true
else
    set -- -c.mac.hardenedRuntime=false -c.mac.timestamp=none
fi

cd "$ROOT"
bun run build:server
bun run --cwd apps/desktop build
# Read by src/main.ts: a local build keeps off the real ledger and port (src/build.ts).
printf '{ "kind": "%s", "version": "%s" }\n' "$KIND" "$VERSION" > "$DESKTOP/dist/build-info.json"

APP="$DESKTOP/release/mac-arm64/Print Tally.app"
rm -rf "$APP"
cd "$DESKTOP"
# electron-builder takes the identity without its certificate-type prefix ("Developer ID Application: ").
bunx electron-builder --mac dir --arm64 --publish never \
    -c.extraMetadata.version="$VERSION" \
    -c.mac.identity="${IDENTITY#*: }" \
    "$@"
printf '%s\n' "$APP"
