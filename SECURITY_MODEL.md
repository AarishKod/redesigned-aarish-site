# Threat model — AarishKod/redesigned-aarish-site

## System overview
Personal portfolio site for Aarish Kodnaney. A fully static site built with Vite 8 (`vite build` → `dist/`) and rendered client-side with three.js 0.185 (`main.js`). Hosted on **Render** (static site; per the user). No backend, no authentication, no forms, no database, no API calls, no cookies/localStorage, no secrets in the repo. No infrastructure-as-code repository exists; Render configuration lives in the Render dashboard (not reviewed).

### Trust boundaries
1. **Visitor browser ↔ static host** — anonymous visitors load `index.html`, `main.js`, `style.css` and assets in `public/`.
2. **Same-origin assets ↔ loaders** — `main.js` loads a GLB model (`public/models/o_model_opt.glb`, via `GLTFLoader` + `MeshoptDecoder`), an HDR environment (`public/models/ferndale_studio_01_1k.hdr`, `RGBELoader`) and a typeface JSON (`public/fonts/Switzer_Black.json`, `FontLoader`). All are first-party, same-origin files committed to the repo.
3. **Build chain ↔ npm registry** — `package-lock.json` pins `three` and `vite` (plus transitive deps) used at build time on Render.
4. **GitHub repo ↔ Render deploy** — pushes to the repo trigger builds/deploys.

## Components
| Name | Covers |
|---|---|
| **Page Shell** | `index.html` (markup, inline modal/menu script), `style.css` |
| **3D Scene** | `main.js` (three.js scene, scroll-driven camera, asset loaders, loading screen) |
| **Static Assets** | `public/` (images, fonts, models, PDFs under `public/subpages/`), `assets-src/` |
| **Build & Dependencies** | `package.json`, `package-lock.json`, Vite build config/defaults, `.claude/launch.json` |
| **Hosting (Render)** | Render static-site config: headers, redirects, TLS (not in repo) |

## Entry points
- Public HTTP GET of all static files (anyone on the internet).
- URL fragment/query (`#…`) — currently not read by any script.
- External links (GitHub, LinkedIn, `mailto:`) — outbound only.
- Build-time: `npm install` / `vite build` on Render.
- Local only: `vite` dev server via `npm run dev` (`.claude/launch.json`, port 5173).

## Assets & sensitivity
- **Site integrity** — the site must not be defaced or serve injected script (reputation).
- **Visitor browser safety** — visitors must not be exposed to XSS, malicious redirects or drive-by content.
- **Build & npm supply chain** — integrity of dependencies pulled at build time.
- **Personal information** — email `kodnaney.a@northeastern.edu`, resume PDFs, photos. *User: intentionally public* (see below). Personal info published unintentionally (e.g. PDF metadata, unreferenced documents, full-res originals in `assets-src/` in a public repo) still counts.
- User priority: **all of the above matter equally** (user answer).

## Attacker profiles
- Anonymous internet visitor / crafted-link sender (XSS via URL, clickjacking, tabnabbing).
- Supply-chain attacker (compromised or vulnerable npm package in `three`/`vite` tree).
- Attacker who gains repo or Render account access (out of the code's control; noted only).
- No authenticated users or insiders exist.

## Existing controls
- No dynamic data rendering: only `textContent` writes (`main.js` loader percentage); no `innerHTML`/`eval`.
- All loaded assets are same-origin, repo-committed.
- Exact versions pinned in `package-lock.json`; `engines.node >=22`.
- `dist/` and `node_modules/` git-ignored.

## Out of scope / accepted risk (user-provided)
- **Email, resume PDFs and other contact information are intentionally public.** Findings about their exposure as such are accepted risk.
- **The Vite dev server is only ever run locally.** Dev-server-only vulnerabilities (e.g. Vite dev server file-serving/CORS/`server.fs` issues) are out of scope for the deployed site.

## Open questions
- Render static-site headers (CSP, HSTS, X-Frame-Options/frame-ancestors, Referrer-Policy) — configured in Render dashboard? Not visible in the repo.
- Are `public/subpages/external-documents/` and `public/subpages/numac/` intended to be published?
- Is the GitHub repo public (exposing `assets-src/` originals and history)?
