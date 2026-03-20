# BatterUp

## Deployment
- Use `./deploy.sh` instead of `firebase deploy` — it auto-bumps the cache version (`?v=` timestamp on CSS/JS imports) so PWA users get fresh files immediately.

## Project Structure
- `web/` — static PWA served by Firebase Hosting
- `web/js/` — vanilla ES modules (no build step)
- `web/css/styles.css` — all styles, with CSS variables for light/dark mode
- `firestore.rules` — Firestore security rules (whitelist-based)
- `firebase.json` — hosting config with security headers

## Conventions
- All colors must use CSS variables (defined in `:root` and overridden in `@media (prefers-color-scheme: dark)`) — no hardcoded hex values in JS or HTML
- Use `esc()` from `helpers.js` for all user-generated content rendered as HTML
- Use `shortName()` from `helpers.js` for displaying customer names (drops last name)
- Home orders (`is_home: true`) are excluded from Orders tab and Reports but included in Materials Needed
- Firestore writes for multiple orders should use `Promise.all`, not sequential awaits
