dev:
	@echo "==> Clearing Vite + build caches to avoid stale-module false positives"
	rm -rf apps/desktop/.vite apps/desktop/node_modules/.vite node_modules/.vite node_modules/.cache
	@echo "==> Ensuring the Electron binary is installed"
	node node_modules/electron/install.js
	@echo "==> Building plugin-sdk (renderer imports from source via Vite)"
	pnpm --filter @nusashell/plugin-sdk run build
	pnpm --filter @nusashell/example-mail run build
	pnpm --filter @nusashell/desktop run dev

test:
	pnpm -r test

# MCP plugins are OPTIONAL - the shell no longer bundles or depends on the
# NusaShell-mcp repository. Install bundled first-party plugins explicitly:
#   make install-plugins NUSASHELL_MCP_REPO=/path/to/NusaShell-mcp
#   make install-plugins NUSASHELL_MCP_REPO=https://github.com/jahrulnr/NusaShell-mcp/archive/refs/heads/master.tar.gz
install-plugins:
	@if [ -z "$${NUSASHELL_MCP_REPO:-}" ]; then \
		echo "Set NUSASHELL_MCP_REPO to the MCP plugins source (git URL, tarball URL, or local dir)." >&2; \
		echo "Example: make install-plugins NUSASHELL_MCP_REPO=/path/to/NusaShell-mcp" >&2; \
		exit 1; \
	fi
	@bash scripts/install-plugins.sh "$${NUSASHELL_MCP_REPO}" "$${NUSASHELL_PLUGINS_DEST:-$$HOME/.local/share/nusashell/plugins}"


# Package the desktop app and install it from the local repo into the user's
# home directory (~/.local/share/nusashell on Linux, ~/Applications on macOS).
# Uses `electron-forge package` (not `make`) so we skip AppImage/deb building —
# those distributables are only needed for GitHub releases, not local installs.
# This mirrors scripts/install.sh (the curl installer) but sources the app
# from the local electron-forge package output instead of a GitHub release.
#
# Safety: only installs the app binary under ~/.local (or ~/Applications).
# Never writes durable app state under ~/.config/nusashell-desktop (or OS appData
# equivalents). verify:package-runtime refuses to ship plugin runtime state
# such as notes.json that local tests/dev may leave under plugins/.
#
# Package pre-cleans apps/desktop/out via rename-away so a running NusaShell
# (or fuseblk .fuse_hidden* tombstones) cannot break electron-forge with ENOTEMPTY.
install:
	@case "$$(uname -s)" in \
		MINGW*|MSYS*|CYGWIN*) NUSASHELL_SKIP_NATIVE_REBUILD=1 pnpm --filter @nusashell/desktop run package;; \
		*) pnpm --filter @nusashell/desktop run package;; \
	esac
	pnpm --filter @nusashell/desktop run verify:package-runtime
	@case "$$(uname -s)" in \
		MINGW*|MSYS*|CYGWIN*) powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-local.ps1;; \
		*) bash scripts/install-local.sh;; \
	esac

# Lightweight gates that prove install/package safety contracts without a full
# electron-forge package (which is slow and requires a free out/ tree).
test-install-safety:
	pnpm --filter @nusashell/desktop exec vitest run tests/stage-plugins-resource.test.ts tests/clean-package-output.test.ts
	pnpm exec vitest run scripts/install.test.mjs
	pnpm --filter @nusashell/example-files exec vitest run tests/fs-service.test.js -t "greps a single file"
