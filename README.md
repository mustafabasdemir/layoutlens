# LayoutLens

Free, open-source, **local-first** tooling for detecting responsive layout issues in websites.

## Features

- Scan a URL with **Chromium** (Playwright)
- **390px**, **768px**, and **1440px** viewport widths
- **Document-level** horizontal overflow detection
- **Element-level** root-cause findings with CSS selectors and bounding boxes
- **Severity** levels: `high`, `medium`, `low`
- **Terminal**, **JSON**, or **offline HTML** reports (no cloud dashboard)

**Phase 3** — Visual HTML report with per-viewport screenshots, bounding-box overlays, and interactive filters.

**Phase 4** — Local **visual regression testing** (pixelmatch baselines, diff images, before/after slider in HTML reports).

**Phase 5–6** — **LayoutLens Studio**: a local React UI to run scans, browse stored reports, and explore findings with zoom/pan overlays and visual comparison modes. A loopback-only **scan API** (`@layoutlens/server`) connects Studio to the real Playwright scanner.

**Phase 7** — **Evidence-based classification** (`confirmed`, `potential`, `insufficient-evidence`), **excluded** overflow candidates (carousels, scroll containers, offscreen/hidden content) with reasons, **visible-only overlays** for partly clipped elements, and matching fields in JSON/HTML reports and Studio.

**Phase 8** — **Advanced responsive analysis** (overlap, text clipping, offscreen controls, touch targets) as separate **advisory** findings in JSON/CLI/Studio; horizontal overflow **exit codes unchanged**. Configure via `ScanOptions.detection` / future CLI flags.

## Requirements

- Node.js 20+
- [pnpm](https://pnpm.io/) 9+

## Setup

```bash
pnpm install
pnpm browser:install
pnpm build
```

## Usage (CLI)

```bash
pnpm cli scan https://example.com
```

Scan the included broken example (use a `file://` URL with the absolute path to `examples/broken-layout/index.html`):

```bash
# macOS / Linux
pnpm cli scan "file://$(pwd)/examples/broken-layout/index.html"

# Windows PowerShell (replace with your clone path)
pnpm cli scan "file:///D:/path/to/layoutlens/examples/broken-layout/index.html"
```

### Options

| Option | Description |
|--------|-------------|
| `--no-headless` | Show the browser while scanning |
| `-H, --height <pixels>` | Viewport height (default `844`) |
| `-f, --format text\|json\|html` | Output format (default `text`) |
| `-o, --output <path>` | File (text/json) or directory (html) |

### JSON report

```bash
pnpm cli scan "file:///…/examples/broken-layout/index.html" --format json --output report.json
```

JSON uses `schemaVersion: "1.0"` and includes:

- `summary` — viewport issue count, total findings, counts by severity and classification, excluded count, truncation flags
- `viewports[]` — per-width document metrics, `findings[]` (with `classification`, `visibleBox`, `reason`), and `excluded[]` groups

Print JSON to stdout:

```bash
pnpm cli scan https://example.com --format json
```

### HTML report (offline)

Generates a folder with `index.html`, `report.json`, and `screenshots/`:

```bash
pnpm cli scan "file:///…/examples/broken-layout/index.html" --format html --output ./layoutlens-report
```

Open `layoutlens-report/index.html` in a browser — no network required. The report includes viewport/severity filters, screenshot previews, highlighted finding boxes, classification labels, and excluded-content summaries. Untrusted scan data is escaped / rendered via `textContent` and safe JSON embedding.

### Visual regression (Phase 4)

Create an explicit baseline (manifest + PNG checksums):

```bash
pnpm cli baseline create "file:///…/examples/broken-layout/index.html" --baseline-dir ./baselines/example
```

Compare during scan (exit `1` if pixels differ beyond thresholds):

```bash
pnpm cli scan "file:///…/examples/broken-layout/index.html" \
  --baseline-dir ./baselines/example \
  --format html --output ./layoutlens-report
```

Safely refresh baselines when the URL matches `manifest.json` (`urlKey`):

```bash
pnpm cli baseline update "file:///…/examples/broken-layout/index.html" --baseline-dir ./baselines/example
```

Optional `examples/visual.config.json` documents thresholds, **masks** (ignore regions), and **stability** settings (disable animations, post-load wait).

Baseline layout:

```
baselines/example/
  manifest.json
  visual.config.json   # optional, copied on create
  screenshots/
    viewport-390.png
    viewport-768.png
    viewport-1440.png
```

HTML reports with `--baseline-dir` add baseline/after **slider**, **diff** PNGs under `visual/`, and comparison stats.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | No layout overflow and no visual regression failures |
| `1` | Layout findings and/or visual regression failures |
| `2` | Scan error (invalid args, navigation failure, etc.) |

## LayoutLens Studio (local UI)

Studio runs on **127.0.0.1** only. The Vite dev server embeds the scan API on the same origin (no separate CORS setup).

```bash
pnpm studio
```

Then open the URL Vite prints (default `http://127.0.0.1:5173/`). Use **Scan Website** to run a real local scan; results and screenshots are stored under `.layoutlens/` (gitignored).

Optional environment variables:

| Variable | Purpose |
|----------|---------|
| `LAYOUTLENS_DATA_DIR` | Override the scan storage directory (default: repo `.layoutlens/`) |

Production-style preview (built assets + scan API):

```bash
pnpm studio:preview
```

Or build Studio and serve it with the standalone server:

```bash
pnpm studio:serve
```

The `@layoutlens/server` package can also be started directly after `pnpm build`:

```bash
pnpm server -- --data-dir .layoutlens
```

Studio supports light/dark theme, scan history, report workspace with viewport tabs, severity/type filters, zoom/pan overlays, visual regression slider/side-by-side/diff views, and honest empty states when no report is loaded.

## Monorepo layout

| Package / app | Role |
|--------|------|
| `packages/shared` | Types, severity rules, classification, JSON report schema |
| `packages/core` | Playwright scan, overflow analysis, screenshots, baselines |
| `packages/visual` | Pixelmatch compare, manifests, masks, stability helpers |
| `packages/report` | Offline HTML report generator |
| `packages/cli` | Commander CLI (`layoutlens scan`, `baseline`) |
| `packages/server` | Loopback scan API and Vite plugin for Studio |
| `apps/studio` | LayoutLens Studio (React + Vite) |
| `examples/broken-layout` | Intentionally broken demo site |
| `examples/layout-cases` | HTML fixtures for integration tests |

## Scripts

```bash
pnpm test      # unit + integration tests (integration needs Chromium)
pnpm build     # compile all packages
pnpm lint      # typecheck all packages
pnpm browser:install
pnpm studio    # Studio dev server with embedded scan API
```

## False-positive reduction

LayoutLens tries to report **root-cause** elements, not every wrapper:

- Skips hidden or zero-size nodes
- Ignores internal scroll containers (`overflow-x: auto/scroll/hidden`) that clip content without extending the page
- Prefers **leaf** elements that extend the viewport (drops ancestors like `main` when a child is the real culprit)
- Uses a small pixel tolerance for sub-pixel layout noise
- **Phase 7** separates confirmed scroll issues from clipped carousels and other excluded overflow via evidence classification

## Principles

- No AI APIs or API keys
- No cloud backend
- No telemetry
- Strict TypeScript

## License

MIT — see [LICENSE](./LICENSE).
