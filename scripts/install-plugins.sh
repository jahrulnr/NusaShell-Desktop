#!/usr/bin/env bash
# Explicit, optional installer for the first-party MCP plugins
# (Files/Terminal/Notes/Kanban) from the NusaShell-mcp repository.
#
# Usage:
#   bash scripts/install-plugins.sh <source> [dest]
#     <source>  local dir | git URL | tarball URL (NusaShell-mcp)
#     [dest]    destination plugins root (default ~/.local/share/nusashell/plugins)
#
# This is NOT run by `make install` or the curl installers - plugins stay
# optional and are installed only when the user asks for them explicitly.
set -euo pipefail

source_spec="${1:?usage: install-plugins.sh <source> [dest]}"
dest="${2:-${HOME}/.local/share/nusashell/plugins}"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/nusashell-plugins.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

echo "Installing MCP plugins from: $source_spec"
echo "Destination: $dest"

case "$source_spec" in
  http://*|https://*)
    echo "Downloading plugins tarball..."
    curl --fail --location --silent --show-error "$source_spec" -o "$tmp/plugins.tar.gz" || wget -qO "$tmp/plugins.tar.gz" "$source_spec"
    mkdir -p "$tmp/src"
    tar -xzf "$tmp/plugins.tar.gz" -C "$tmp/src" --strip-components=1
    ;;
  git@*|ssh://*)
    echo "Cloning plugins repository..."
    git clone --depth 1 "$source_spec" "$tmp/src"
    ;;
  *)
    if [[ ! -d "$source_spec" ]]; then echo "Source is not a directory: $source_spec" >&2; exit 1; fi
    cp -R "$source_spec/." "$tmp/src/"
    ;;
esac

mkdir -p "$dest"
# Ship only real plugin folders (manifest.json + mcp/) - never the repo root files.
for candidate in "$tmp"/src/*; do
  if [[ -f "$candidate/manifest.json" && -d "$candidate/mcp" ]]; then
    name="$(basename "$candidate")"
    rm -rf "$dest/$name"
    cp -R "$candidate" "$dest/$name"
    echo "Installed plugin: $name"
  fi
done

echo "Done. Plugins are installed under $dest - restart NusaShell to load them."
