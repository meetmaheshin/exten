#!/bin/bash
# Debian/RPM postinst hook for Ailancers Tracker.
#
# Electron embeds Chromium, which needs its `chrome-sandbox` helper to be
# setuid-root (mode 4755). Without this, every launch dies with:
#   "FATAL:setuid_sandbox_host.cc(158) The SUID sandbox helper binary was
#    found, but is not configured correctly."
#
# electron-builder generates the .deb but doesn't apply the right mode by
# default — Debian's packaging policy actively strips setuid bits during
# fakeroot build, so the file ends up 0755. We restore it here at install
# time, when the script is running as real root.
#
# References:
#   - https://github.com/electron-userland/electron-builder/issues/2781
#   - https://github.com/electron/electron/issues/17972
set -e

# The install directory uses the productName from electron-builder.yml,
# which contains a space ("Ailancers Tracker") — quote everything carefully.
SANDBOX="/opt/Ailancers Tracker/chrome-sandbox"

if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX"
  chmod 4755 "$SANDBOX"
fi

exit 0
