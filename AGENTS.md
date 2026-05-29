# Codex Project Instructions

This repository is deployed directly from GitHub `main` to GitHub Pages for `https://9677.fun`.

Before editing:
- Run `git fetch origin`.
- Confirm local `main` is current with `origin/main`.
- Run `node scripts/check-cloud-version.mjs` and note the GitHub `main` version and live site version.

When changing app behavior:
- Keep changes scoped to the user request.
- If the user says the current front-car detection is good, do not change YOLO target selection, lock tracking, or movement detection unless explicitly asked.
- Bump the app version for every deployed behavior change.
- Use `node scripts/bump-version.mjs X.Y.Z` to update `app.js`, `index.html`, and `sw.js` together.

Before finishing:
- Run `node --check app.js`.
- Run `node scripts/check-cloud-version.mjs` before pushing if you need to compare against cloud state.
- Commit the change.
- Push to `origin main`.
- After pushing, run `node scripts/check-cloud-version.mjs` again and verify the live site eventually reports the new version.

Deployment source of truth:
- GitHub repo: `roger9677gmail/green-light-alert-pwa`
- Branch: `main`
- Live site: `https://9677.fun`

If Web Codex shows a newer version locally but the live site is old, the change has not reached `origin/main` or GitHub Pages has not served it yet.
