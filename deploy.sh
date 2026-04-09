#!/usr/bin/env bash
# =============================================================
# Deckspace — One-shot deploy script
#
# Usage:
#   ./deploy.sh                  # check + commit + push + deploy + verify
#   ./deploy.sh --no-commit      # deploy current HEAD, skip git commit
#   ./deploy.sh --check-only     # run checks, don't deploy
#
# Prerequisites:
#   - .env.local with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
#   - node (for syntax/CSS checks)
#   - curl (for post-deploy verification)
# =============================================================

set -euo pipefail

BRANCH="claude/deckspace-pdr-IhYsR"
PROJECT="deckspace"
NO_COMMIT=false
CHECK_ONLY=false

for arg in "$@"; do
  case $arg in
    --no-commit)  NO_COMMIT=true ;;
    --check-only) CHECK_ONLY=true ;;
  esac
done

# Load credentials from .env.local
if [ -f .env.local ]; then
  set -a; source .env.local; set +a
else
  echo "⚠  No .env.local found — deploy will fail without CLOUDFLARE_API_TOKEN"
fi

# ─────────────────────────────────────────────────────────────
# STEP 1 — PRE-FLIGHT CHECKS
# ─────────────────────────────────────────────────────────────
echo ""
echo "── Pre-flight checks ────────────────────────────────────"

# JS syntax check
echo "  · JS syntax..."
FAILED=0
for f in functions/\[\[path\]\].js src/lib/*.js src/templates/*.js src/routes/*.js; do
  [ -f "$f" ] || continue
  node --check "$f" 2>&1 && true || { echo "    ✗ $f — syntax error"; FAILED=1; }
done
[ "$FAILED" = "0" ] && echo "    ✓ all JS files OK"
[ "$FAILED" = "1" ] && echo "ABORT: fix JS errors before deploying" && exit 1

# CSS brace balance
echo "  · CSS brace balance..."
node --input-type=module <<'JSEOF'
import { readFileSync } from 'fs';
const css = readFileSync('public/css/deckspace.css', 'utf8');
let depth = 0, line = 1;
for (const ch of css) {
  if (ch === '\n') line++;
  if (ch === '{') depth++;
  if (ch === '}') { depth--; if (depth < 0) { console.error(`    ✗ CSS: depth went negative at line ${line}`); process.exit(1); } }
}
if (depth !== 0) { console.error(`    ✗ CSS: ${depth} unclosed braces`); process.exit(1); }
console.log('    ✓ CSS braces balanced');
JSEOF

# Conflict markers
echo "  · Conflict markers..."
if grep -rn "^<<<<<<< \|^=======$\|^>>>>>>> " src/ public/ --include="*.js" --include="*.css" 2>/dev/null; then
  echo "ABORT: resolve git conflict markers before deploying"
  exit 1
fi
echo "    ✓ no conflict markers"

# Removed feature references
echo "  · No stale imports (messages, guestbook)..."
STALE=$(grep -rn "messagesRoutes\|guestbookModule\|getGuestbookEntries\|getUnreadMessageCount" src/ functions/ 2>/dev/null || true)
if [ -n "$STALE" ]; then
  echo "    ✗ stale references found:"
  echo "$STALE"
  exit 1
fi
echo "    ✓ clean"

# CSS file exists
if [ ! -f "public/css/deckspace.css" ]; then
  echo "ABORT: public/css/deckspace.css is missing"
  exit 1
fi

echo ""
echo "✓  All checks passed"

[ "$CHECK_ONLY" = "true" ] && echo "(--check-only: skipping deploy)" && exit 0

# ─────────────────────────────────────────────────────────────
# STEP 2 — GIT COMMIT + PUSH
# ─────────────────────────────────────────────────────────────
if [ "$NO_COMMIT" = "false" ]; then
  echo ""
  echo "── Git ──────────────────────────────────────────────────"
  git add -A
  if git diff --cached --quiet; then
    echo "  (nothing to commit)"
  else
    git commit -m "Deploy: $(date -u '+%Y-%m-%d %H:%M UTC')"
  fi
  git push -u origin "$BRANCH"
fi

# ─────────────────────────────────────────────────────────────
# STEP 3 — DEPLOY
# ─────────────────────────────────────────────────────────────
echo ""
echo "── Deploying to Cloudflare Pages ────────────────────────"
DEPLOY_OUTPUT=$(CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  npx wrangler pages deploy public \
    --project-name="$PROJECT" \
    --branch="$BRANCH" 2>&1)

echo "$DEPLOY_OUTPUT"

# Extract the preview URL from deploy output
DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-z0-9]+\.deckspace\.pages\.dev' | tail -1)

# ─────────────────────────────────────────────────────────────
# STEP 4 — VERIFY
# ─────────────────────────────────────────────────────────────
if [ -n "$DEPLOY_URL" ]; then
  echo ""
  echo "── Post-deploy verification ─────────────────────────────"

  # CSS check
  CSS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$DEPLOY_URL/css/deckspace.css" 2>/dev/null || echo "ERR")
  if [ "$CSS_CODE" = "200" ]; then
    echo "  ✓ CSS loads ($DEPLOY_URL/css/deckspace.css → 200)"
  else
    echo "  ✗ CSS returned $CSS_CODE — DESIGN WILL BE BROKEN"
  fi

  # Home page check
  HOME_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$DEPLOY_URL/" 2>/dev/null || echo "ERR")
  if [ "$HOME_CODE" = "200" ] || [ "$HOME_CODE" = "302" ]; then
    echo "  ✓ Home page responds ($HOME_CODE)"
  else
    echo "  ✗ Home page returned $HOME_CODE"
  fi

  echo ""
  echo "✓  Live at: $DEPLOY_URL"
fi
