# LayoutLens

**Catch broken layouts before your users do.**

LayoutLens is a **local-first** developer tool that uses **Chromium (Playwright)** to scan web pages—and, via **LayoutLens Studio**, **same-origin multi-page sites**—at responsive widths. It detects **horizontal overflow** with **evidence-based classification**, optional **advanced responsive advisories**, **per-viewport screenshots**, optional **visual regression** against saved baselines, and **offline HTML reports**. There is **no cloud account, API keys, or telemetry**.

**Documentation:** [English](README.md) · [Türkçe](docs/README.tr.md)

---

![LayoutLens Studio — Multi-page website scanning and site-wide dashboard](docs/readme-site-overview.png)

*Real Studio run on [weather.gov](https://www.weather.gov): **10 pages**, **30 viewport inspections**, site-wide summary, and Page Explorer. Third-party sites and results may change.*

---

## Key features

### Multi-page website scanning

Start from a single URL and discover pages within the **same origin**, with **bounded** crawl limits (Studio defaults such as **up to 10 pages** and a configurable **max depth**—not an unlimited spider). Each page gets full viewport inspection, screenshots, and a per-page report.

### Site-wide dashboard

See **completed vs failed pages**, **viewport task progress**, **confirmed and potential layout findings**, **responsive advisories**, and **navigation quality** in one panel after a site scan finishes.

### Page Explorer

Browse every scanned page in a table: status, finding counts, affected viewports, screenshot preview, **Open report** (per-page workspace), and **Retry page** when a failure is eligible.

### Responsive overflow detection

Horizontal overflow and contributing DOM elements are measured in a real Chromium session—not static HTML guesses.

![LayoutLens Studio — scan summary and findings (weather.gov, mobile viewport)](docs/readme-weather-gov-studio.png)

*Example single-page viewport: overflow findings and classification on a public site.*

### Evidence-based classification

Findings are labeled (e.g. **confirmed** vs **potential** vs insufficient evidence). Excluded patterns—such as carousels—include reasons. Overlays respect **visible geometry** when content is partly clipped.

### Advanced responsive advisories

Beyond horizontal overflow, reports can include **overlap**, **text clipping**, **offscreen controls**, and **touch target** issues as separate advanced findings in JSON and Studio.

### Interactive DOM Inspector

After a scan, pick elements on the screenshot and inspect selector paths, geometry, and captured CSS context when inspector snapshots are present.

![LayoutLens Studio — pointer-based element selection in Inspector mode (weather.gov)](docs/readme-weather-gov-inspector.png)

*Inspector: select elements on the captured viewport and inspect DOM/selector context.*

### Custom viewports

Configure viewport **width and height** per scan in Studio (e.g. mobile, tablet, desktop presets or custom sizes). Reports record non-default dimensions in schema **1.4** when needed.

### Live scan progress

Studio shows **real progress** for site scans: discovery, per-page work, and **per-viewport** tasks—not a fake progress bar.

### Cancel & retry

**Cancel** an in-flight scan or site retry from Studio. **Retry** failed **page** or **viewport** tasks when policy allows (HTTP **403** / permanent errors are not auto-retried; attempts are **bounded** per task).

### Offline HTML reports

Self-contained bundles (`index.html`, screenshots, `report.json`) work without a server or CDN for single-page runs; multi-page site envelopes use `layoutlens-site` JSON on disk and in Studio.

### Visual regression

Optional **pixelmatch** comparison vs a saved baseline (`layoutlens baseline create|update`), with diff views in Studio and HTML reports.

### Reliable navigation

Summaries reflect HTTP status, redirects, and trust hints. Separate timeouts for navigation, readiness, and screenshots; bounded recovery when the document is usable but `load` is slow; **per-viewport** success, failure, or skipped status.

### Local-first & privacy

Runs on your machine. Scan output stays under your chosen data directory (default **`.layoutlens/`**, typically gitignored). **No** mandatory cloud, signup, shipped API keys, or telemetry in this repository.

---

## Quick Start

**Requirements:** Node.js **20+**, [pnpm](https://pnpm.io/) **9+** (see root `package.json`).

```bash
git clone https://github.com/mustafabasdemir/layoutlens.git
cd layoutlens
pnpm install
pnpm browser:install
pnpm build
```

Installs Playwright’s Chromium binary (`pnpm browser:install`).

Scan a URL (CLI wraps `packages/cli/dist/index.js`):

```bash
pnpm cli scan https://example.com
```

Scan the bundled **broken layout** demo with an absolute `file://` URL (adjust the path for your OS):

From the repository root, use an absolute `file://` URL (paths must point at your clone):

```bash
# macOS / Linux (bash)
pnpm cli scan "file://${PWD}/examples/broken-layout/index.html"
```

```powershell
# Windows PowerShell — replace D:\dev\layoutlens if your clone lives elsewhere
pnpm cli scan "file:///D:/dev/layoutlens/examples/broken-layout/index.html"
```

---

## CLI usage

Entrypoint: `layoutlens` (see `packages/cli/src/index.ts`, version **0.4.0**).

**Commands**

| Command | Purpose |
|---------|---------|
| `scan <url>` | Scan a **single** page (`http`, `https`, or `file:`) |
| `baseline create <url>` | Create a visual baseline (requires `--baseline-dir`) |
| `baseline update <url>` | Update baseline when URL matches manifest |

Multi-page **site** scanning is available through **LayoutLens Studio** and the local scan API (`mode: multi_page`), not the CLI `scan` subcommand today.

**`scan` options (representative)**

| Option | Description |
|--------|-------------|
| `--no-headless` | Show the browser window |
| `-H, --height <px>` | Viewport height (default **844**) |
| `-f, --format <format>` | Output: `text` (default), `json`, or `html` |
| `-o, --output <path>` | File for `text`/`json`, **directory** for `html` |
| `-b, --baseline-dir <path>` | Compare screenshots to a baseline |
| `-c, --visual-config <path>` | JSON for thresholds, masks, stability |
| `--nav-timeout-ms` | `page.goto` timeout (`waitUntil: domcontentloaded`) |
| `--readiness-timeout-ms` | Wait for `load` after DOMContentLoaded |
| `--screenshot-timeout-ms` | Per-viewport screenshot timeout |
| `--post-load-settle-ms` | Bounded delay after readiness before measurement |

HTML report requires `-o`:

```bash
# macOS / Linux — ${PWD} is the repo root in your shell
pnpm cli scan "file://${PWD}/examples/broken-layout/index.html" --format html --output ./layoutlens-report
```

```powershell
# Windows PowerShell
pnpm cli scan "file:///D:/dev/layoutlens/examples/broken-layout/index.html" --format html --output ./layoutlens-report
```

Open `layoutlens-report/index.html` in a browser — no CDN required for the bundle.

---

## LayoutLens Studio

Local React + Vite UI (`apps/studio`), wired to a **loopback-only** scan API (`@layoutlens/server`).

- **Single-page scan** — Enter a URL; inspect findings, screenshots, inspector, and visual regression per report.
- **Multi-page site scan** — Choose multi-page mode, set **max pages** (default cap such as **10**) and **crawl depth**, optionally customize viewports, then open the **site-wide dashboard** and **Page Explorer** when the run completes.
- **Cancel / retry** — Stop long runs; retry eligible failed pages or viewports from the dashboard (subject to server limits).

**Development (from repo root):**

```bash
pnpm studio
```

Use the URL Vite prints (often `http://127.0.0.1:5173/`).

**Production-style: build Studio and serve static assets + API**

```bash
pnpm studio:serve
```

**Environment / storage**

| Variable / command | Role |
|--------------------|------|
| `LAYOUTLENS_DATA_DIR` | Override where scan artifacts are stored (else **`.layoutlens/`** under the process working directory; typically gitignored) |
| `pnpm server` | Runs **`layoutlens-server`** after `pnpm build`. Use `pnpm server -- --help` for flags (`--host` defaults to **127.0.0.1**, `--port`, `--data-dir`, `--static-dir`, etc.). |

The API binds to **127.0.0.1** by default, validates origins, and applies URL policy (schemes, SSRF-related checks, optional private-network rules). See `packages/server/src/cli.ts` and `packages/server/src/http-api.ts`.

---

## Interactive DOM Inspector

- **Studio:** After opening a report, enable inspector-style interaction on the screenshot (element selection, related navigation) where snapshot data exists.
- **Server-driven scans** run with inspector capture **enabled** for Studio (`packages/server/src/scan-service.ts`).
- **Offline HTML** bundles can include the same inspector experience when reports embed the snapshot (see `packages/report` Playwright tests for `file://` behavior).

Inspector data is **bounded** (limits on depth, elements, selector length); huge pages may truncate — the report states when limits apply.

---

## Visual regression

1. Create a baseline directory with explicit screenshots + manifest:

   ```bash
   pnpm cli baseline create "file://${PWD}/examples/broken-layout/index.html" --baseline-dir ./baselines/example
   ```

2. Compare on scan:

   ```bash
   pnpm cli scan "file://${PWD}/examples/broken-layout/index.html" \
     --baseline-dir ./baselines/example \
     --format html --output ./layoutlens-report
   ```

   On Windows PowerShell, use the same absolute `file:///D:/.../examples/broken-layout/index.html` form as in Quick Start.

Optional `examples/visual.config.json` documents masks and stability tuning.

---

## Navigation reliability

Scans use **`domcontentloaded`** for initial navigation, then a **readiness** phase (including bounded handling when `load` is slow or background network activity continues), separate **screenshot** timeouts, and **per-viewport** inspection status in JSON/Studio. This avoids relying on `networkidle` for long-lived sites.

---

## Reports and CLI exit codes

- **JSON** reports include `schemaVersion` (e.g. **1.3** / **1.4**), `summary`, `viewports[]`, optional `navigation`, `navigationDiagnostics`, and inspector snapshots when captured. Site scans add `tool: layoutlens-site` with `pages[]` and site-wide findings.
- **`exitCodeForResult`** (`packages/cli/src/format.ts`):
  - **0** — No horizontal overflow issues, no visual regression failures, navigation does not block trust, and the scan **fully** completed all viewports (no partial/skipped/failed inspection counts).
  - **1** — Layout and/or visual differences, **or** HTTP/navigation conditions treated as issues, **or** **partial / failed** viewport inspection.
  - **2** — CLI usage error or thrown scan error (e.g. invalid args, hard failure before a usable result).

---

## Architecture

Monorepo (pnpm workspaces):

| Package / app | Role |
|---------------|------|
| `packages/shared` | Types, report schema, classification, inspector and navigation helpers, site-scan schema |
| `packages/core` | Playwright scanner, overflow and responsive analysis, screenshots, **site crawl (`scanSite`)** |
| `packages/visual` | Baselines, pixelmatch compare, masks |
| `packages/report` | Offline HTML report generator |
| `packages/cli` | Commander CLI (single-page `scan`) |
| `packages/server` | Local scan API, multi-page jobs, retry/cancel, static Studio serving |
| `apps/studio` | LayoutLens Studio UI (single-page + site dashboard) |
| `examples/` | Demos and HTML fixtures for tests (`broken-layout`, `layout-cases`, `responsive-cases`, etc.) |

---

## Development and testing

```bash
pnpm lint      # Typecheck all packages
pnpm test      # Unit + integration tests (Chromium required for Playwright suites)
pnpm build     # Build all packages
pnpm browser:install
```

---

## Privacy and local-first principles

- **No** mandatory cloud service or signup.
- **No** API keys shipped for scanning.
- **No** telemetry in this repository’s tooling.
- Scan output and history live in your configured/local directories.

---

## Contributing

Issues and pull requests are welcome. Please run `pnpm lint` and `pnpm test` before submitting substantial changes.
