#!/bin/sh
# Makes and signs apps/desktop/release/PrintTally-<version>.dmg from a built app (apps/desktop/scripts/bundle.sh):
# the app on the left, an Applications link on the right, over apps/desktop/assets/dmg/background.svg.
set -eu

DESKTOP=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)

APP=${1:-"$DESKTOP/release/mac-arm64/Print Tally.app"}
case "$APP" in
    /*) ;;
    *) APP="$PWD/$APP" ;;
esac
if [ ! -f "$APP/Contents/Info.plist" ]; then
    printf 'ERROR: App bundle not found: %s\n' "$APP" >&2
    exit 1
fi
VERSION=$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist")
OUTPUT="$DESKTOP/release/PrintTally-$VERSION.dmg"

RELEASE=${PRINTTALLY_RELEASE:-0}
# shellcheck source=apps/desktop/scripts/signing.sh
. "$DESKTOP/scripts/signing.sh"

SVG="$DESKTOP/assets/dmg/background.svg"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/printtally-dmg.XXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM

cat > "$WORK/render.swift" <<'SWIFT'
import AppKit

let svgURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputs = [
    (URL(fileURLWithPath: CommandLine.arguments[2]), 660, 400),
    (URL(fileURLWithPath: CommandLine.arguments[3]), 1320, 800),
]
guard let image = NSImage(contentsOf: svgURL) else {
    fputs("make-dmg: cannot load \(svgURL.path)\n", stderr)
    exit(1)
}
for (outputURL, width, height) in outputs {
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0
    ), let context = NSGraphicsContext(bitmapImageRep: rep) else {
        fputs("make-dmg: cannot create \(width)x\(height) bitmap\n", stderr)
        exit(1)
    }
    rep.size = NSSize(width: width, height: height)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.cgContext.interpolationQuality = .high
    image.draw(
        in: NSRect(x: 0, y: 0, width: width, height: height),
        from: .zero, operation: .copy, fraction: 1
    )
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else {
        fputs("make-dmg: cannot encode \(outputURL.path)\n", stderr)
        exit(1)
    }
    do {
        try png.write(to: outputURL)
    } catch {
        fputs("make-dmg: cannot write \(outputURL.path): \(error)\n", stderr)
        exit(1)
    }
}
SWIFT

# electron-builder combines background.png and background@2x.png beside it into one HiDPI image.
swift "$WORK/render.swift" "$SVG" "$WORK/background.png" "$WORK/background@2x.png"

rm -f "$OUTPUT"
cd "$DESKTOP"
bunx electron-builder --mac dmg --arm64 --publish never --prepackaged "$APP" \
    -c.extraMetadata.version="$VERSION" \
    -c.dmg.background="$WORK/background.png"
if [ ! -f "$OUTPUT" ]; then
    printf 'ERROR: electron-builder did not write %s\n' "$OUTPUT" >&2
    exit 1
fi

if [ "$IDENTITY" = "-" ]; then
    printf 'WARNING: %s is not signed, because the app was ad-hoc signed.\n' "$OUTPUT" >&2
elif [ "$RELEASE" = "1" ]; then
    codesign --sign "$IDENTITY" --timestamp "$OUTPUT"
else
    codesign --sign "$IDENTITY" "$OUTPUT"
fi
printf '%s\n' "$OUTPUT"
