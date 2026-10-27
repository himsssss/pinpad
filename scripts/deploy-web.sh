#!/bin/bash
# Publishes the web build to the gh-pages branch, which GitHub Pages serves at
# https://himsssss.github.io/pinpad/. Run after pushing changes: npm run deploy:web
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE=$(git remote get-url origin)
npm run build

OUT=$(mktemp -d)
cp -R dist/. "$OUT"
touch "$OUT/.nojekyll" # serve files as-is, without Jekyll processing
cd "$OUT"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name)" -c user.email="$(git -C "$OLDPWD" config user.email)" \
  commit -q -m "Deploy $(git -C "$OLDPWD" rev-parse --short HEAD)"
git push -q -f "$REMOTE" gh-pages
rm -rf "$OUT"
echo "Published https://himsssss.github.io/pinpad/"
