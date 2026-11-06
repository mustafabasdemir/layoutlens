import { designTokensCss, navigationBannerMessage, navigationRedirectNote, type JsonReport } from "@layoutlens/shared";
import {
  COMPARE_SLIDER_HELP,
  COMPARE_SLIDER_IDENTICAL_HINT,
  VISUAL_DIFF_EXPLANATION,
  VISUAL_DIFF_NOT_LAYOUT_COUNT,
  VISUAL_VIEW_MODES,
} from "./compare-slider.js";
import {
  MISSING_BASELINE_MESSAGE,
  MISSING_CURRENT_MESSAGE,
  MISSING_DIFF_MESSAGE,
  SLIDER_KEYBOARD_STEP,
} from "./before-after-slider.js";
import { escapeHtml, safeJsonForHtmlScript } from "./escape.js";
import {
  buildSetupVisualRegressionPanelScript,
  buildVisualPanelClientScript,
} from "./embed/visual-panel-client.js";
import { buildInspectorOfflineScript } from "./embed/inspector-offline.js";

export function buildHtmlReportDocument(report: JsonReport): string {
  const title = escapeHtml(`LayoutLens — ${report.url}`);
  const payload = safeJsonForHtmlScript(report);
  const compareHelp = JSON.stringify(COMPARE_SLIDER_HELP);
  const compareIdenticalHint = JSON.stringify(COMPARE_SLIDER_IDENTICAL_HINT);
  const visualDiffExplanation = JSON.stringify(VISUAL_DIFF_EXPLANATION);
  const visualDiffNotLayout = JSON.stringify(VISUAL_DIFF_NOT_LAYOUT_COUNT);
  const visualViewModesJson = JSON.stringify(VISUAL_VIEW_MODES);
  const missingBaselineMsg = JSON.stringify(MISSING_BASELINE_MESSAGE);
  const missingCurrentMsg = JSON.stringify(MISSING_CURRENT_MESSAGE);
  const missingDiffMsg = JSON.stringify(MISSING_DIFF_MESSAGE);
  const sliderKeyboardStep = String(SLIDER_KEYBOARD_STEP);
  const visualPanelClientScript = buildVisualPanelClientScript();
  const setupVisualRegressionPanelScript = buildSetupVisualRegressionPanelScript();
  const inspectorOfflineScript = buildInspectorOfflineScript();

  const navForHero = report.navigation ?? report.summary.navigation;
  const navBannerHtml = navForHero ? escapeHtml(navigationBannerMessage(navForHero) ?? "") : "";
  const navRedirectHtml =
    navForHero && !navigationBannerMessage(navForHero)
      ? escapeHtml(navigationRedirectNote(navForHero) ?? "")
      : "";
  const navMetaHtml = navForHero
    ? escapeHtml(
        `Requested: ${navForHero.requestedUrl}` +
          (navForHero.finalUrl !== navForHero.requestedUrl ? ` · Final: ${navForHero.finalUrl}` : "") +
          (navForHero.httpStatus !== null ? ` · HTTP ${navForHero.httpStatus}` : ""),
      )
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none';" />
  <title>${title}</title>
  <script>
    (function () {
      var theme = null;
      try { theme = localStorage.getItem("layoutlens.report.theme"); } catch (e) {}
      if (!theme && window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) theme = "light";
      document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
    })();
  </script>
  <style>
${designTokensCss()}
    :root {
      --bg: var(--ll-bg);
      --surface: var(--ll-surface);
      --surface2: var(--ll-surface-elevated);
      --text: var(--ll-text);
      --muted: var(--ll-text-secondary);
      --border: var(--ll-border);
      --high: var(--ll-danger);
      --med: var(--ll-warning);
      --low: var(--ll-info);
      --ok: var(--ll-success);
      --accent: var(--ll-accent);
      font-family: var(--ll-font-sans);
    }
    * { box-sizing: border-box; }
    .hero-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
    .theme-toggle {
      flex-shrink: 0;
      border: 1px solid var(--border);
      background: var(--surface2);
      color: var(--text);
      border-radius: var(--ll-radius-md);
      padding: 0.35rem 0.7rem;
      font: inherit;
      font-size: 0.8rem;
      cursor: pointer;
    }
    .theme-toggle:hover { background: var(--ll-surface-hover); }
    :focus-visible { outline: none; box-shadow: var(--ll-focus-ring); }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    header.hero {
      padding: 1.5rem clamp(1rem, 3vw, 2rem);
      background: linear-gradient(135deg, var(--surface) 0%, var(--surface2) 100%);
      border-bottom: 1px solid var(--border);
    }
    header.hero h1 {
      margin: 0 0 0.25rem;
      font-size: clamp(1.25rem, 2.5vw, 1.75rem);
    }
    .meta { color: var(--muted); font-size: 0.9rem; word-break: break-all; }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      padding: 1rem clamp(1rem, 3vw, 2rem);
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      position: sticky;
      top: 0;
      z-index: 5;
    }
    .toolbar label { font-size: 0.75rem; color: var(--muted); display: block; margin-bottom: 0.25rem; }
    .chip-row { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .chip {
      border: 1px solid var(--border);
      background: var(--surface2);
      color: var(--text);
      border-radius: 999px;
      padding: 0.25rem 0.65rem;
      font-size: 0.8rem;
      cursor: pointer;
    }
    .chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
    main { padding: 1rem clamp(1rem, 3vw, 2rem) 2rem; max-width: 1200px; margin: 0 auto; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }
    .stat {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0.85rem 1rem;
    }
    .stat strong { display: block; font-size: 1.35rem; }
    .stat span { color: var(--muted); font-size: 0.8rem; }
    .viewport-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    .viewport-card.hidden { display: none; }
    .viewport-head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .badge {
      display: inline-block;
      border-radius: 6px;
      padding: 0.1rem 0.45rem;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge.high { background: color-mix(in srgb, var(--high) 25%, transparent); color: var(--high); }
    .badge.medium { background: color-mix(in srgb, var(--med) 25%, transparent); color: var(--med); }
    .badge.low { background: color-mix(in srgb, var(--low) 25%, transparent); color: var(--low); }
    .badge.ok { background: color-mix(in srgb, var(--ok) 25%, transparent); color: var(--ok); }
    .badge.cls { background: var(--surface); color: var(--text); border: 1px solid var(--border); margin-left: 0.3rem; }
    .badge.cls-confirmed { border-color: var(--high); }
    .badge.cls-potential { border-color: var(--med); }
    .notice {
      margin: 0 0 0.75rem;
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--med);
      border-radius: 8px;
      font-size: 0.85rem;
      background: color-mix(in srgb, var(--med) 10%, transparent);
    }
    .finding-reason { font-size: 0.82rem; margin-top: 0.35rem; }
    .finding-note { font-size: 0.78rem; margin-top: 0.3rem; color: var(--med); }
    .excluded { margin-top: 0.75rem; font-size: 0.85rem; }
    .excluded summary { cursor: pointer; font-weight: 600; }
    .excluded ul { list-style: none; margin: 0.5rem 0 0; padding: 0; }
    .excluded li { border: 1px dashed var(--border); border-radius: 8px; padding: 0.5rem 0.65rem; margin-bottom: 0.4rem; }
    .excluded code { word-break: break-all; }
    .layout-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1rem;
    }
    @media (min-width: 900px) {
      .layout-grid { grid-template-columns: 1.2fr 1fr; align-items: start; }
    }
    .shot-shell {
      position: relative;
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      background: #000;
    }
    .shot-shell img { display: block; width: 100%; height: auto; vertical-align: top; }
    .shot-shell.ll-inspector-on img {
      cursor: crosshair;
      position: relative;
      z-index: 3;
      pointer-events: auto;
    }
    .ll-inspector-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      padding: 0.45rem 0.6rem;
      background: var(--surface2);
      border-bottom: 1px solid var(--border);
      font-size: 0.78rem;
    }
    .ll-inspector-toggle {
      font: inherit;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      border-radius: 8px;
      padding: 0.3rem 0.65rem;
      font-size: 0.78rem;
    }
    .ll-inspector-toggle:disabled { opacity: 0.55; cursor: not-allowed; }
    .ll-inspector-toggle[aria-pressed="true"] {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 18%, var(--surface));
    }
    .ll-inspector-meta { color: var(--muted); font-size: 0.72rem; }
    .ll-inspector-panel {
      padding: 0.65rem 0.75rem;
      border-top: 1px solid var(--border);
      background: var(--surface);
      font-size: 0.8rem;
    }
    .ll-inspector-panel.hidden { display: none; }
    .ll-inspector-panel h4 { margin: 0 0 0.4rem; font-size: 0.88rem; }
    .ll-inspector-warn {
      margin: 0 0 0.5rem;
      padding: 0.45rem 0.55rem;
      border-radius: 6px;
      border: 1px solid var(--med);
      background: color-mix(in srgb, var(--med) 12%, transparent);
      font-size: 0.78rem;
    }
    .ll-inspector-pre {
      margin: 0 0 0.5rem;
      padding: 0.45rem 0.55rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface2);
      font-size: 0.72rem;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 12rem;
      overflow: auto;
    }
    .ll-inspector-related { margin: 0.5rem 0; }
    .ll-inspector-related-title { font-weight: 600; font-size: 0.78rem; margin-bottom: 0.35rem; }
    .ll-inspector-related-btn {
      display: block;
      width: 100%;
      text-align: left;
      font: inherit;
      font-size: 0.76rem;
      cursor: pointer;
      margin-bottom: 0.35rem;
      padding: 0.35rem 0.5rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface2);
      color: var(--text);
    }
    .ll-inspector-related-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .ll-inspector-parent, .ll-inspector-next {
      font: inherit;
      font-size: 0.78rem;
      cursor: pointer;
      margin: 0.35rem 0.35rem 0 0;
      padding: 0.35rem 0.6rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface2);
      color: var(--text);
    }
    .ll-inspector-styles {
      list-style: none;
      margin: 0.35rem 0 0;
      padding: 0;
      max-height: 10rem;
      overflow: auto;
      font-size: 0.72rem;
    }
    .ll-inspector-styles li { padding: 0.15rem 0; border-bottom: 1px dashed color-mix(in srgb, var(--border) 60%, transparent); }
    .ll-inspector-layer {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 2;
    }
    .ll-inspector-outline {
      position: absolute;
      box-sizing: border-box;
      border: 2px solid var(--accent);
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      border-radius: 2px;
      pointer-events: none;
    }
    .ll-inspector-outline.is-hover { border-color: var(--low); background: color-mix(in srgb, var(--low) 14%, transparent); }
    .ll-inspector-outline.is-selected { border-color: var(--accent); }
    .shot-overlays {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 1;
    }
    .shot-overlays .box {
      pointer-events: none;
    }
    .box {
      position: absolute;
      border: 2px solid var(--high);
      background: color-mix(in srgb, var(--high) 18%, transparent);
      border-radius: 2px;
      transition: box-shadow 0.15s ease, border-color 0.15s ease;
    }
    .box.medium { border-color: var(--med); background: color-mix(in srgb, var(--med) 18%, transparent); }
    .box.low { border-color: var(--low); background: color-mix(in srgb, var(--low) 18%, transparent); }
    .box.active { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 55%, transparent); }
    .findings { list-style: none; margin: 0; padding: 0; }
    .finding {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.65rem 0.75rem;
      margin-bottom: 0.5rem;
      cursor: pointer;
      background: var(--surface2);
    }
    .finding.hidden { display: none; }
    .finding.active { outline: 2px solid var(--accent); }
    .finding code { font-size: 0.78rem; word-break: break-all; }
    .finding-meta { color: var(--muted); font-size: 0.78rem; margin-top: 0.25rem; }
    .visual-panel {
      margin-top: 1rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--border);
    }
    .visual-panel h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
    .compare-help {
      font-size: 0.85rem;
      color: var(--muted);
      margin: 0.35rem 0 0.5rem;
    }
    .compare-labels {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin: 0.35rem 0;
    }
    .compare-frame {
      position: relative;
      width: 100%;
      overflow: hidden;
      background: #000;
    }
    .compare-frame img.compare-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: fill;
      object-position: top left;
      display: block;
      pointer-events: none;
    }
    .compare-after { z-index: 1; }
    .compare-before-clip {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      overflow: hidden;
      z-index: 2;
      border-right: 3px solid var(--accent);
      box-sizing: border-box;
      box-shadow: 2px 0 8px rgba(0, 0, 0, 0.35);
    }
    .compare-before-clip img.compare-layer {
      position: absolute;
      top: 0;
      left: 0;
      max-width: none;
      object-fit: fill;
      object-position: top left;
    }
    .shot-shell.compare-focus,
    .shot-shell.slider-focus {
      display: none;
    }
    .compare-error {
      margin-top: 0.5rem;
      padding: 0.75rem;
      border: 1px solid var(--high);
      border-radius: 8px;
      color: var(--high);
      font-size: 0.85rem;
    }
    .slider-row input[type=range].ba-range-sync {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .ba-slider-stage {
      touch-action: none;
      user-select: none;
      cursor: ew-resize;
      outline: none;
    }
    .ba-slider-stage:focus-visible {
      box-shadow: 0 0 0 2px var(--accent);
    }
    .ba-divider-handle {
      position: absolute;
      top: 0;
      left: 50%;
      height: 100%;
      width: 44px;
      margin-left: -22px;
      z-index: 3;
      cursor: ew-resize;
      touch-action: none;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
    }
    .ba-divider-line {
      width: 3px;
      height: 100%;
      background: var(--accent);
      box-shadow: 0 0 8px rgba(0, 0, 0, 0.45);
      border-radius: 2px;
    }
    .ba-divider-knob {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--surface);
      border: 2px solid var(--accent);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    }
    .visual-side-by-side {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
      width: 100%;
      max-width: 100%;
    }
    @media (max-width: 640px) {
      .visual-side-by-side { grid-template-columns: 1fr; }
    }
    .visual-side-by-side figure {
      margin: 0;
      min-width: 0;
    }
    .visual-side-by-side figcaption {
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      margin-bottom: 0.35rem;
    }
    .visual-side-by-side .compare-frame {
      width: 100%;
    }
    .visual-side-by-side img.compare-layer {
      position: relative;
      width: 100%;
      height: auto;
      object-fit: fill;
    }
    .visual-missing {
      padding: 0.75rem;
      border: 1px dashed var(--border);
      border-radius: 8px;
      color: var(--muted);
      font-size: 0.85rem;
    }
    .visual-panel {
      margin-top: 1rem;
      padding: 0.85rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface2);
    }
    .visual-panel h3 { margin: 0 0 0.35rem; font-size: 0.95rem; }
    .visual-stats { margin: 0.35rem 0; font-weight: 600; font-size: 0.9rem; }
    .visual-meta {
      margin: 0.25rem 0;
      font-size: 0.82rem;
      color: var(--muted);
    }
    .visual-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem 1.25rem;
      margin: 0.5rem 0;
      font-size: 0.8rem;
    }
    .visual-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
    .visual-legend-swatch {
      width: 14px;
      height: 14px;
      border-radius: 3px;
      border: 1px solid var(--border);
      flex-shrink: 0;
    }
    .visual-legend-swatch.changed { background: #ff00b4; }
    .visual-legend-swatch.unchanged { background: #6b7280; opacity: 0.55; }
    .visual-mode-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin: 0.65rem 0 0.5rem;
    }
    .visual-mode-btn {
      font: inherit;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      border-radius: 999px;
      padding: 0.35rem 0.75rem;
      font-size: 0.78rem;
    }
    .visual-mode-btn[aria-pressed="true"] {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 22%, var(--surface));
    }
    .visual-view-pane { display: none; }
    .visual-view-pane.active { display: block; }
    .visual-single-frame { position: relative; width: 100%; overflow: hidden; background: #000; }
    .visual-single-frame img.compare-layer {
      position: relative;
      width: 100%;
      height: auto;
      object-fit: fill;
      object-position: top left;
      display: block;
    }
    footer { text-align: center; color: var(--muted); font-size: 0.75rem; padding: 1rem; }
    .nav-warn {
      margin-top: 0.75rem;
      padding: 0.65rem 0.85rem;
      border-radius: 10px;
      border: 1px solid var(--med);
      background: color-mix(in srgb, var(--med) 12%, transparent);
      font-size: 0.88rem;
    }
    .nav-warn.danger {
      border-color: var(--high);
      background: color-mix(in srgb, var(--high) 12%, transparent);
    }
    .nav-warn.hidden { display: none; }
  </style>
</head>
<body>
  <header class="hero">
    <div class="hero-top">
      <h1>LayoutLens Report</h1>
      <button type="button" class="theme-toggle" id="theme-toggle" data-testid="theme-toggle">Light theme</button>
    </div>
    <p class="meta" id="report-url"></p>
    <p class="meta" id="report-time"></p>
    ${navBannerHtml ? `<div class="nav-warn danger" id="report-nav-banner" data-testid="report-nav-banner"><strong>Navigation</strong><p style="margin:0.35rem 0 0">${navBannerHtml}</p><p class="meta" style="margin:0.5rem 0 0">${navMetaHtml}</p><p class="meta" style="margin:0.35rem 0 0">The screenshot and findings below describe what the browser received — they may not match the site you intended to test.</p></div>` : navRedirectHtml ? `<div class="nav-warn" id="report-nav-redirect" data-testid="report-nav-redirect"><p style="margin:0">${navRedirectHtml}</p><p class="meta" style="margin:0.35rem 0 0">${navMetaHtml}</p></div>` : ""}
  </header>
  <div class="toolbar" id="filters"></div>
  <main>
    <div class="stats" id="stats"></div>
    <div id="viewports"></div>
  </main>
  <footer>Offline report — generated by LayoutLens (local-first, no telemetry)</footer>
  <script type="application/json" id="layoutlens-data">${payload}</script>
  <script>
    (function () {
      var dataEl = document.getElementById("layoutlens-data");
      var report = JSON.parse(dataEl.textContent || "{}");

      function text(el, value) {
        el.textContent = value == null ? "" : String(value);
      }

      var themeBtn = document.getElementById("theme-toggle");
      function syncThemeButton() {
        var light = document.documentElement.getAttribute("data-theme") === "light";
        text(themeBtn, light ? "Dark theme" : "Light theme");
        themeBtn.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
      }
      themeBtn.addEventListener("click", function () {
        var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", next);
        try { localStorage.setItem("layoutlens.report.theme", next); } catch (e) {}
        syncThemeButton();
      });
      syncThemeButton();

      text(document.getElementById("report-url"), report.url || "");
      text(document.getElementById("report-time"), report.scannedAt ? "Scanned: " + report.scannedAt : "");

      var state = { viewport: "all", severity: "all", evidence: "all" };
      var CLASS_LABELS = { confirmed: "Confirmed", potential: "Potential", "insufficient-evidence": "Insufficient evidence" };
      var EXCLUSION_LABELS = { "clipped-by-ancestor": "Clipped by an ancestor", "inside-scroll-container": "Inside a scroll container", offscreen: "Positioned offscreen", hidden: "Hidden" };
      function evidenceOf(f) { return f.classification || "unclassified"; }
      function overlayBox(f) {
        if (f.visibleBox === null) return null;
        return f.visibleBox || f.boundingBox;
      }
      function screenshotNote(f, vp) {
        if (f.invisible) return "Not visible in the screenshot: the element is invisible (visibility or opacity) but still takes up layout space.";
        if (f.visibleBox === null) return "Not visible in the screenshot: no part of it is painted inside the " + vp.width + "px viewport. Actual box: x " + f.boundingBox.x + ", y " + f.boundingBox.y + ", " + f.boundingBox.width + "×" + f.boundingBox.height + ".";
        var b = overlayBox(f);
        if (b && b.y >= vp.viewportHeight) return "Below the captured area: the screenshot shows only the first " + vp.viewportHeight + "px of the page (element starts at y " + b.y + ").";
        if (f.visibleBox && f.visibleBox.width < f.boundingBox.width - 1) return "The outline shows only the visible part (" + f.visibleBox.width + "px of " + f.boundingBox.width + "px); the rest is past the viewport edge.";
        return "";
      }
      var compareHelpText = ${compareHelp};
      var compareIdenticalHintText = ${compareIdenticalHint};
      var visualDiffExplanationText = ${visualDiffExplanation};
      var visualDiffNotLayoutText = ${visualDiffNotLayout};
      var visualViewModes = ${visualViewModesJson};
      var missingBaselineMsg = ${missingBaselineMsg};
      var missingCurrentMsg = ${missingCurrentMsg};
      var missingDiffMsg = ${missingDiffMsg};
      var sliderKeyboardStep = ${sliderKeyboardStep};

      function formatVisualDiffStats(diffPixels, diffPixelRatio) {
        var pct = (diffPixelRatio * 100).toFixed(2);
        return diffPixels.toLocaleString() + " pixels changed (" + pct + "% of image)";
      }

      ${visualPanelClientScript}

      ${setupVisualRegressionPanelScript}

      ${inspectorOfflineScript}

      function sevBadge(sev) {
        var s = document.createElement("span");
        s.className = "badge " + sev;
        text(s, sev);
        return s;
      }

      function renderFilters() {
        var root = document.getElementById("filters");
        while (root.firstChild) root.removeChild(root.firstChild);

        var vpWrap = document.createElement("div");
        var vpLabel = document.createElement("label");
        text(vpLabel, "Viewport");
        vpWrap.appendChild(vpLabel);
        var vpRow = document.createElement("div");
        vpRow.className = "chip-row";
        [["all", "All"], ["390", "390 mobile"], ["768", "768 tablet"], ["1440", "1440 desktop"]].forEach(function (pair) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "chip";
          btn.setAttribute("aria-pressed", state.viewport === pair[0] ? "true" : "false");
          text(btn, pair[1]);
          btn.addEventListener("click", function () {
            state.viewport = pair[0];
            applyFilters();
            renderFilters();
          });
          vpRow.appendChild(btn);
        });
        vpWrap.appendChild(vpRow);
        root.appendChild(vpWrap);

        var sevWrap = document.createElement("div");
        var sevLabel = document.createElement("label");
        text(sevLabel, "Severity");
        sevWrap.appendChild(sevLabel);
        var sevRow = document.createElement("div");
        sevRow.className = "chip-row";
        [["all", "All"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]].forEach(function (pair) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "chip";
          btn.setAttribute("aria-pressed", state.severity === pair[0] ? "true" : "false");
          text(btn, pair[1]);
          btn.addEventListener("click", function () {
            state.severity = pair[0];
            applyFilters();
            renderFilters();
          });
          sevRow.appendChild(btn);
        });
        sevWrap.appendChild(sevRow);
        root.appendChild(sevWrap);

        var hasClasses = (report.viewports || []).some(function (vp) {
          return (vp.findings || []).some(function (f) { return !!f.classification; });
        });
        if (!hasClasses) return;
        var evWrap = document.createElement("div");
        var evLabel = document.createElement("label");
        text(evLabel, "Evidence");
        evWrap.appendChild(evLabel);
        var evRow = document.createElement("div");
        evRow.className = "chip-row";
        [["all", "All"], ["confirmed", "Confirmed"], ["potential", "Potential"], ["insufficient-evidence", "Insufficient evidence"]].forEach(function (pair) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "chip";
          btn.setAttribute("aria-pressed", state.evidence === pair[0] ? "true" : "false");
          text(btn, pair[1]);
          btn.addEventListener("click", function () {
            state.evidence = pair[0];
            applyFilters();
            renderFilters();
          });
          evRow.appendChild(btn);
        });
        evWrap.appendChild(evRow);
        root.appendChild(evWrap);
      }

      function renderStats() {
        var root = document.getElementById("stats");
        while (root.firstChild) root.removeChild(root.firstChild);
        var s = report.summary || {};
        var cls = s.byClassification;
        var items = [
          ["Viewport issues", String(s.viewportIssueCount || 0)],
          ["Findings", String(s.findingCount || 0)]
        ];
        if (cls) {
          items.push(["Confirmed", String(cls.confirmed)]);
          items.push(["Potential", String(cls.potential)]);
          items.push(["Insufficient evidence", String(cls.insufficientEvidence)]);
          items.push(["Excluded (intentional)", String(s.excludedCount || 0)]);
        }
        if (s.advancedFindingCount != null) {
          items.push(["Responsive (advisory)", String(s.advancedFindingCount)]);
        }
        items = items.concat([
          ["Visual fails", String(report.summary && report.summary.visualFailures != null ? report.summary.visualFailures : (report.visual ? report.visual.failedCount : 0))],
          ["High", String(report.summary && report.summary.bySeverity ? report.summary.bySeverity.high : 0)],
          ["Medium", String(report.summary && report.summary.bySeverity ? report.summary.bySeverity.medium : 0)],
          ["Low", String(report.summary && report.summary.bySeverity ? report.summary.bySeverity.low : 0)]
        ]);
        if (s.truncated) {
          var warn = document.createElement("p");
          warn.className = "notice";
          warn.dataset.testid = "truncated-notice";
          text(warn, "Results are truncated: at least one viewport hit a reporting limit. The counts below cover only what was reported; see each viewport for details.");
          root.parentNode.insertBefore(warn, root);
        } else if (!cls && (s.findingCount || 0) > 0) {
          var legacy = document.createElement("p");
          legacy.className = "notice";
          text(legacy, "This report was produced by an older LayoutLens version: findings are not classified by evidence, and that version kept at most 25 findings per viewport without saying when it dropped some.");
          root.parentNode.insertBefore(legacy, root);
        }
        items.forEach(function (pair) {
          var card = document.createElement("div");
          card.className = "stat";
          var strong = document.createElement("strong");
          text(strong, pair[1]);
          var span = document.createElement("span");
          text(span, pair[0]);
          card.appendChild(strong);
          card.appendChild(span);
          root.appendChild(card);
        });
      }

      function renderViewports() {
        var root = document.getElementById("viewports");
        while (root.firstChild) root.removeChild(root.firstChild);

        (report.viewports || []).forEach(function (vp, vpIndex) {
          var card = document.createElement("section");
          card.className = "viewport-card";
          card.dataset.viewport = String(vp.width);

          var head = document.createElement("div");
          head.className = "viewport-head";
          var h = document.createElement("h2");
          h.style.margin = "0";
          h.style.fontSize = "1.05rem";
          text(h, vp.width + "px (" + vp.label + ")");
          head.appendChild(h);
          var a = vp.analysis;
          var masked = vp.hasHorizontalOverflow && a && !a.userScrollable && a.maskedOverflowPx > 0;
          var status = document.createElement("span");
          status.className = "badge " + (masked ? "medium" : vp.hasHorizontalOverflow ? "high" : "ok");
          text(status, masked ? "Hidden overflow " + vp.overflowPx + "px" : vp.hasHorizontalOverflow ? "Overflow " + vp.overflowPx + "px" : "OK");
          head.appendChild(status);
          card.appendChild(head);

          var notes = [];
          if (masked) notes.push("The document is " + vp.overflowPx + "px wider than the viewport, but overflow-x: " + a.rootOverflowX + " on html/body hides it, so users cannot scroll to that content.");
          if (a && a.findingsOmitted > 0) notes.push("Truncated: " + a.findingsOmitted + " more finding group(s) beyond the " + a.findingLimit + "-group limit are not listed.");
          if (a && a.excludedOmitted > 0) notes.push("Truncated: " + a.excludedOmitted + " more excluded group(s) beyond the " + a.excludedLimit + "-group limit are not listed.");
          if (a && a.candidatesOmitted > 0) notes.push("Truncated: " + a.candidatesOmitted + " edge-crossing element(s) beyond the " + a.candidateLimit + "-element limit were not analysed.");
          if (a && a.unattributedOverflowPx > 0) notes.push(a.unattributedOverflowPx + "px of document overflow could not be attributed to any measured element.");
          notes.forEach(function (n) {
            var p = document.createElement("p");
            p.className = "notice";
            text(p, n);
            card.appendChild(p);
          });

          var grid = document.createElement("div");
          grid.className = "layout-grid";

          var shotCol = document.createElement("div");
          if (vp.screenshot) {
            var shell = document.createElement("div");
            shell.className = "shot-shell";
            var img = document.createElement("img");
            img.src = vp.screenshot;
            img.alt = "Viewport " + vp.width + " screenshot";
            shell.appendChild(img);
            var overlays = document.createElement("div");
            overlays.className = "shot-overlays";
            shell.appendChild(overlays);
            shell.dataset.vpIndex = String(vpIndex);
            shotCol.appendChild(shell);
            llMountInspector(shell, vp, vpIndex);

            img.addEventListener("load", function () {
              var w = vp.width;
              var h = vp.viewportHeight;
              (vp.findings || []).forEach(function (f, fi) {
                var b = overlayBox(f);
                if (!b) return;
                var box = document.createElement("div");
                box.className = "box " + f.severity;
                box.dataset.vpIndex = String(vpIndex);
                box.dataset.findingIndex = String(fi);
                box.style.left = (b.x / w * 100) + "%";
                box.style.top = (b.y / h * 100) + "%";
                box.style.width = (b.width / w * 100) + "%";
                box.style.height = (b.height / h * 100) + "%";
                overlays.appendChild(box);
              });
              applyFilters();
            });

            if (vp.visualCompare) {
              var visualPanel = document.createElement("div");
              visualPanel.className = "visual-panel";
              var vh = document.createElement("h3");
              text(vh, "Visual regression");
              visualPanel.appendChild(vh);
              setupVisualRegressionPanel(visualPanel, vp, shell);
              shotCol.appendChild(visualPanel);
            }
          } else {
            var missing = document.createElement("p");
            missing.className = "meta";
            text(missing, "Screenshot not available.");
            shotCol.appendChild(missing);
          }
          grid.appendChild(shotCol);

          var list = document.createElement("ul");
          list.className = "findings";
          (vp.findings || []).forEach(function (f, fi) {
            var li = document.createElement("li");
            li.className = "finding";
            li.dataset.viewport = String(vp.width);
            li.dataset.severity = f.severity;
            li.dataset.evidence = evidenceOf(f);
            li.dataset.vpIndex = String(vpIndex);
            li.dataset.findingIndex = String(fi);
            if (f.id) {
              li.dataset.inspectorFindingId = f.id;
            }

            var row = document.createElement("div");
            row.appendChild(sevBadge(f.severity));
            if (f.classification) {
              var cb = document.createElement("span");
              cb.className = "badge cls cls-" + f.classification;
              text(cb, CLASS_LABELS[f.classification] || f.classification);
              row.appendChild(cb);
            }
            row.appendChild(document.createTextNode(" "));
            var code = document.createElement("code");
            text(code, f.selector);
            row.appendChild(code);
            li.appendChild(row);

            if (f.reason) {
              var reason = document.createElement("div");
              reason.className = "finding-reason";
              text(reason, f.reason);
              li.appendChild(reason);
            }

            var meta = document.createElement("div");
            meta.className = "finding-meta";
            var impact = f.classification === "confirmed" ? "+" + f.scrollContributionPx + "px page width" : f.documentContributionPx + "px past viewport edge";
            var extra = f.relatedCount > 0 ? " · +" + f.relatedCount + " related element" + (f.relatedCount === 1 ? "" : "s") : "";
            var ambiguous = f.selectorMatches > 1 ? " · selector matches " + f.selectorMatches + " elements" : "";
            text(meta, impact + " · " + f.tagName + " · box " + f.boundingBox.width + "×" + f.boundingBox.height + extra + ambiguous);
            li.appendChild(meta);

            var note = screenshotNote(f, vp);
            if (note) {
              var nn = document.createElement("div");
              nn.className = "finding-note";
              text(nn, note);
              li.appendChild(nn);
            }

            li.addEventListener("click", function () {
              document.querySelectorAll(".finding.active, .box.active").forEach(function (n) { n.classList.remove("active"); });
              li.classList.add("active");
              var box = document.querySelector('.box[data-vp-index="' + vpIndex + '"][data-finding-index="' + fi + '"]');
              if (box) box.classList.add("active");
            });

            list.appendChild(li);
          });
          var listCol = document.createElement("div");
          listCol.appendChild(list);
          if (vp.excluded && vp.excluded.length > 0) {
            var det = document.createElement("details");
            det.className = "excluded";
            var sum = document.createElement("summary");
            var elements = vp.excluded.reduce(function (n, e) { return n + e.elementCount; }, 0);
            text(sum, "Excluded as intentional: " + elements + " element(s) in " + vp.excluded.length + " group(s)");
            det.appendChild(sum);
            var ul = document.createElement("ul");
            vp.excluded.forEach(function (e) {
              var item = document.createElement("li");
              var label = document.createElement("strong");
              text(label, (EXCLUSION_LABELS[e.reason] || e.reason) + " · " + e.elementCount + " element(s) ");
              item.appendChild(label);
              var c = document.createElement("code");
              text(c, e.selector);
              item.appendChild(c);
              var ex = document.createElement("div");
              ex.className = "finding-meta";
              text(ex, e.explanation);
              item.appendChild(ex);
              ul.appendChild(item);
            });
            det.appendChild(ul);
            listCol.appendChild(det);
          }
          grid.appendChild(listCol);
          card.appendChild(grid);
          root.appendChild(card);
        });
      }

      function applyFilters() {
        document.querySelectorAll(".viewport-card").forEach(function (card) {
          var w = card.dataset.viewport;
          var showVp = state.viewport === "all" || state.viewport === w;
          card.classList.toggle("hidden", !showVp);
        });
        document.querySelectorAll(".finding").forEach(function (item) {
          var showVp = state.viewport === "all" || state.viewport === item.dataset.viewport;
          var showSev = state.severity === "all" || state.severity === item.dataset.severity;
          var showEv = state.evidence === "all" || state.evidence === item.dataset.evidence;
          item.classList.toggle("hidden", !(showVp && showSev && showEv));
        });
        document.querySelectorAll(".box").forEach(function (box) {
          var vpCard = document.querySelector('.viewport-card[data-viewport="' + report.viewports[Number(box.dataset.vpIndex)].width + '"]');
          if (!vpCard || vpCard.classList.contains("hidden")) {
            box.style.display = "none";
            return;
          }
          var fi = Number(box.dataset.findingIndex);
          var vp = report.viewports[Number(box.dataset.vpIndex)];
          var f = vp.findings[fi];
          var showSev = state.severity === "all" || state.severity === f.severity;
          var showEv = state.evidence === "all" || state.evidence === evidenceOf(f);
          box.style.display = showSev && showEv ? "block" : "none";
        });
      }

      renderStats();
      renderFilters();
      renderViewports();
    })();
  </script>
</body>
</html>
`;
}
