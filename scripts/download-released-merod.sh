#!/usr/bin/env bash
# Download the newest released merod for linux-x86_64, extracting ./merod.
#
# Walks back through recent releases rather than taking only the newest: GitHub
# publishes a release object before its binary matrix finishes uploading, so the
# newest tag can carry no merod yet while the one before it is perfectly usable.
set -euo pipefail

REPO="calimero-network/core"                    # where merod is released
ASSET="merod_x86_64-unknown-linux-gnu.tar.gz"   # the CI runner's platform
LOOKBACK=10                                     # releases to walk back through

for tag in $(gh release list --repo "$REPO" --limit "$LOOKBACK" --json tagName -q '.[].tagName'); do
  # gh exposes an asset's download URL as `.url`, not `.browser_download_url`.
  url=$(gh release view "$tag" --repo "$REPO" --json assets \
    -q ".assets[] | select(.name == \"$ASSET\") | .url")
  if [ -n "$url" ]; then
    echo "Downloading $ASSET from $tag"
    curl -sL "$url" | tar xz
    chmod +x ./merod
    exit 0
  fi
  echo "release $tag has no $ASSET yet; trying the one before it"
done

echo "::error::no $ASSET in the last $LOOKBACK releases of $REPO" >&2
exit 1
