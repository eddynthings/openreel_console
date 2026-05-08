#!/usr/bin/env bash
#
# install.sh — OpenReel Console setup
#
# Copies the bridge plugin and SDK into your OpenReel project,
# installs the Claude Code skill, and prints the manual patches required.
#
# Usage:
#   ./install.sh [/path/to/openreel-project]
#
# If no path is given, you will be prompted.
#

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Colors ────────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { printf "  ${GREEN}[OK]${NC}  %s\n" "$*"; }
warn() { printf "  ${YELLOW}[WARN]${NC} %s\n" "$*"; }
err()  { printf "  ${RED}[ERR]${NC}  %s\n" "$*" >&2; }
step() { printf "\n${BOLD}%s${NC}\n" "$*"; }

# ── Prerequisites ─────────────────────────────────────────────────────────────

step "Checking prerequisites..."

node_ok=true
ffmpeg_ok=true

if ! command -v node &>/dev/null; then
  err "node not found. Install Node.js >= 18 from https://nodejs.org"
  node_ok=false
else
  NODE_VER=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
  if [[ "$NODE_VER" -lt 18 ]]; then
    err "Node.js >= 18 required (found v${NODE_VER})"
    node_ok=false
  else
    ok "Node.js v${NODE_VER}"
  fi
fi

if [[ "$node_ok" == "false" ]]; then
  exit 1
fi

if ! command -v ffmpeg &>/dev/null; then
  warn "ffmpeg not found — proxy generation will not work."
  warn "Install: brew install ffmpeg   (macOS) | sudo apt install ffmpeg   (Linux)"
else
  ok "ffmpeg $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}')"
fi

if ! command -v git &>/dev/null; then
  err "git not found."
  exit 1
else
  ok "git"
fi

# ── OpenReel project root ─────────────────────────────────────────────────────

step "Locating OpenReel project..."

if [[ -n "${1:-}" ]]; then
  OR_ROOT="$1"
else
  echo ""
  echo "  OpenReel is a self-hosted video editor. If you don't have it installed,"
  echo "  get it at https://openreel.com before continuing."
  echo ""
  read -rp "  OpenReel project root (absolute path): " OR_ROOT
fi

OR_ROOT="${OR_ROOT%/}"

if [[ ! -f "$OR_ROOT/apps/web/vite.config.ts" ]]; then
  err "'$OR_ROOT/apps/web/vite.config.ts' not found."
  err "Ensure you're pointing to the OpenReel project root directory."
  exit 1
fi

ok "Found OpenReel project at: $OR_ROOT"

# ── Copy plugin files ─────────────────────────────────────────────────────────

step "Copying files..."

cp "$SKILL_DIR/plugin/vite-plugin-bridge.ts" "$OR_ROOT/apps/web/vite-plugin-bridge.ts"
ok "vite-plugin-bridge.ts → apps/web/"

mkdir -p "$OR_ROOT/apps/web/src/services"
cp "$SKILL_DIR/plugin/dev-bridge.ts" "$OR_ROOT/apps/web/src/services/dev-bridge.ts"
ok "dev-bridge.ts → apps/web/src/services/"

mkdir -p "$OR_ROOT/apps/web/src/hooks"
cp "$SKILL_DIR/plugin/patches/useProjectRecovery.ts" "$OR_ROOT/apps/web/src/hooks/useProjectRecovery.ts"
ok "useProjectRecovery.ts → apps/web/src/hooks/ (patched: suppresses dialog when bridge manages session)"

cp "$SKILL_DIR/sdk/openreel-sdk.mjs" "$OR_ROOT/openreel-sdk.mjs"
ok "openreel-sdk.mjs → project root"

cp "$SKILL_DIR/scripts/generate-proxies.sh" "$OR_ROOT/generate-proxies.sh"
chmod +x "$OR_ROOT/generate-proxies.sh"
ok "generate-proxies.sh → project root"

# ── Install ws dependency ─────────────────────────────────────────────────────

step "Checking 'ws' WebSocket dependency..."

WEB_PKG="$OR_ROOT/apps/web/package.json"
if grep -q '"ws"' "$WEB_PKG" 2>/dev/null; then
  ok "'ws' already declared in apps/web/package.json"
else
  warn "'ws' not found in apps/web/package.json."
  if command -v pnpm &>/dev/null && [[ -f "$OR_ROOT/pnpm-workspace.yaml" ]]; then
    echo ""
    read -rp "  Install 'ws' now with pnpm? [Y/n] " yn
    yn="${yn:-Y}"
    if [[ "$yn" =~ ^[Yy]$ ]]; then
      (cd "$OR_ROOT" && pnpm add -D ws --filter "$(basename "$OR_ROOT/apps/web")" 2>/dev/null) \
        && ok "'ws' installed" \
        || warn "Could not auto-install 'ws'. Run: cd $OR_ROOT && pnpm add -D ws"
    fi
  else
    warn "Run: cd $OR_ROOT/apps/web && npm install --save-dev ws"
  fi
fi

# ── Install Claude Code skill ─────────────────────────────────────────────────

step "Installing Claude Code skill..."

CLAUDE_SKILL="$HOME/.claude/skills/openreel"
mkdir -p "$CLAUDE_SKILL"
cp "$SKILL_DIR/SKILL.md" "$CLAUDE_SKILL/SKILL.md"
ok "SKILL.md → ~/.claude/skills/openreel/SKILL.md"

# ── Manual patches ────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "${BOLD}  MANUAL PATCHES REQUIRED${NC}\n"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
printf "${BOLD}1. apps/web/vite.config.ts${NC} — register the bridge plugin\n"
echo ""
echo "   Add this import at the top of the file:"
echo '   ┌────────────────────────────────────────────────────────────'
echo '   │ import { openreelBridgePlugin } from "./vite-plugin-bridge";'
echo '   └────────────────────────────────────────────────────────────'
echo ""
echo "   Then add the plugin to the plugins array:"
echo '   ┌────────────────────────────────────────────────────────────'
echo '   │ plugins: [react(), openreelBridgePlugin()],'
echo '   └────────────────────────────────────────────────────────────'

echo ""
printf "${BOLD}2. apps/web/src/main.tsx${NC} — call initDevBridge() on startup\n"
echo ""
echo "   Add this import:"
echo '   ┌────────────────────────────────────────────────────────────'
echo '   │ import { initDevBridge } from "./services/dev-bridge";'
echo '   └────────────────────────────────────────────────────────────'
echo ""
echo "   Call it before ReactDOM.createRoot:"
echo '   ┌────────────────────────────────────────────────────────────'
echo '   │ initDevBridge();'
echo '   └────────────────────────────────────────────────────────────'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "${BOLD}  Setup complete!${NC}\n"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  After applying the patches above:"
echo ""
echo "  1. Start OpenReel:  cd $OR_ROOT && pnpm dev"
echo "     You should see:  🌉 OpenReel Bridge  ws://localhost:7175"
echo ""
echo "  2. Open OpenReel in your browser (port Vite reports on startup)"
echo "     You should see in the browser console:"
echo "     [OpenReel Console] Connected — ready for commands"
echo ""
echo "  3. From a terminal in $OR_ROOT, run:"
echo "     node -e \"import('./openreel-sdk.mjs').then(async m => {"
echo "       const s = await m.openreel.getState();"
echo "       console.log(s);"
echo "       await m.openreel.disconnect();"
echo "     })\""
echo ""
