#!/usr/bin/env bash
# Install the native-messaging host manifest for Brave and the brave-tabs CLI.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
ext_id="nonjheegmgeonamccahabomomcfjlafh"
name="com.olivierg.hiddentabby_bridge"
host_dir="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"

chmod 755 "$here/host.py" "$here/brave-tabs"
mkdir -p "$host_dir" "$HOME/.local/bin"
cat > "$host_dir/$name.json" <<JSON
{
  "name": "$name",
  "description": "HiddenTabby local agent bridge",
  "path": "$here/host.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ext_id/"]
}
JSON
ln -sfn "$here/brave-tabs" "$HOME/.local/bin/brave-tabs"
echo "Installed $host_dir/$name.json and ~/.local/bin/brave-tabs"
