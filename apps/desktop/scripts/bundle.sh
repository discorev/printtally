#!/bin/sh
# Builds and signs apps/desktop/release/mac-arm64/Print Tally.app (docs/build.md). A local build by default;
# PRINTTALLY_RELEASE=1 for a release build, which CI then notarizes (docs/release.md). The app embeds the
# server compiled from this checkout, or the one in PRINTTALLY_SERVER_ARCHIVE (a backend release's
# printtally-server-<version>-darwin-arm64.tar.gz), which is how CI ships a published backend.
set -eu

DESKTOP=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
ROOT=$(CDPATH='' cd -- "$DESKTOP/../.." && pwd)

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

# shellcheck source=apps/desktop/scripts/signing.sh
. "$DESKTOP/scripts/signing.sh"
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

SERVER_ARCHIVE=${PRINTTALLY_SERVER_ARCHIVE:-}
case "$SERVER_ARCHIVE" in
    ''|/*) ;;
    *) SERVER_ARCHIVE="$PWD/$SERVER_ARCHIVE" ;;
esac

cd "$ROOT"
if [ -n "$SERVER_ARCHIVE" ]; then
    # electron-builder.yml takes the server and its UI from apps/server/dist.
    rm -rf apps/server/dist/printtally-server apps/server/dist/client
    mkdir -p apps/server/dist
    tar -xzf "$SERVER_ARCHIVE" -C apps/server/dist printtally-server client
else
    bun run build:server
fi
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
