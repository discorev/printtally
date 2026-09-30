# Sourced by apps/desktop/scripts/bundle.sh and apps/desktop/scripts/make-dmg.sh with RELEASE set. Sets IDENTITY to
# PRINTTALLY_SIGN_IDENTITY or the first Developer ID Application identity in the keychain, or to "-"
# (ad hoc) for a local build run with PRINTTALLY_ALLOW_ADHOC_SIGNING=1.
# shellcheck shell=sh

IDENTITY=${PRINTTALLY_SIGN_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)}
if [ "$RELEASE" = "1" ]; then
    if [ -z "$IDENTITY" ] || [ "$IDENTITY" = "-" ]; then
        printf '%s\n' \
            'ERROR: No Developer ID Application signing identity found.' \
            'Install a signing certificate or set PRINTTALLY_SIGN_IDENTITY to a valid identity.' \
            'Ad-hoc signing is not allowed when PRINTTALLY_RELEASE=1.' >&2
        exit 1
    fi
elif [ -z "$IDENTITY" ]; then
    if [ "${PRINTTALLY_ALLOW_ADHOC_SIGNING:-0}" = "1" ]; then
        IDENTITY=-
    else
        printf '%s\n' \
            'ERROR: No Developer ID Application signing identity found.' \
            'Install a signing certificate or set PRINTTALLY_SIGN_IDENTITY to a valid identity.' \
            'To deliberately use an unstable ad-hoc signature, rerun with:' \
            '  PRINTTALLY_ALLOW_ADHOC_SIGNING=1 bun run dist:desktop' >&2
        exit 1
    fi
fi
