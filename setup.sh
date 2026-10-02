#!/usr/bin/env bash
# Copies a GitHub token to the clipboard and opens Chrome's extensions page,
# then prints the remaining manual steps. Chrome does not allow scripts to
# install unpacked extensions or write their settings, so those stay manual.
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"

copy() {
  if command -v pbcopy >/dev/null; then pbcopy
  elif command -v wl-copy >/dev/null; then wl-copy
  elif command -v xclip >/dev/null; then xclip -selection clipboard
  elif command -v clip.exe >/dev/null; then clip.exe
  else return 1
  fi
}

open_extensions_page() {
  case "$(uname -s)" in
    Darwin) open -a "Google Chrome" "chrome://extensions" 2>/dev/null ;;
    Linux) (google-chrome "chrome://extensions" || chromium "chrome://extensions") >/dev/null 2>&1 & ;;
    *) return 1 ;;
  esac
}

token=""
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  token="$(gh auth token)"
  echo "Using the token from your gh login."
else
  echo "gh is not installed or not logged in."
  echo "Either run 'gh auth login' and re-run this script, or create a fine-grained token with"
  echo "read-only 'Pull requests' access at https://github.com/settings/personal-access-tokens/new"
fi

if [ -n "$token" ]; then
  if printf '%s' "$token" | copy; then
    echo "Token copied to the clipboard."
  else
    echo "No clipboard tool found. Run 'gh auth token' and copy the output yourself."
  fi
fi

open_extensions_page || echo "Open chrome://extensions in Chrome."

cat <<EOF

Next steps in Chrome:
  1. Turn on Developer mode (top right of chrome://extensions).
  2. Click "Load unpacked" and choose:
       $dir
  3. Open the extension's Details, then "Extension options".
  4. Paste the token and click Save.
  5. Reload any GitHub pull request list.

If your organization enforces SAML single sign-on, the token must be authorized
for that organization. gh asks for this during 'gh auth login'; for a personal
access token, use "Configure SSO" next to the token on GitHub's token settings page.
EOF
