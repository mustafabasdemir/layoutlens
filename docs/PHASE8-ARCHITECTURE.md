# Phase 8 — Architecture extension points

## Existing pipeline (Phase 7)

1. **Browser:** `collectLayoutEvidence` in `packages/core/src/layout-evidence.ts` — raw overflow candidates, clippers, document metrics.
2. **Node:** `classifyLayoutEvidence` in `packages/core/src/classify.ts` — confirmed / potential / insufficient / excluded overflow findings.
3. **Orchestration:** `detectHorizontalOverflow` → `scanUrl` per viewport.
4. **Reports:** `OverflowFinding` in `findings[]`; optional `excluded[]`, `analysis` on each viewport; summary counts and `schemaVersion: "1.0"`.

## Phase 8 additions

| Layer | Module | Role |
|--------|--------|------|
| Shared types | `packages/shared/src/responsive.ts` | `AdvancedFinding`, categories, `DetectionConfig`, summary `byAdvancedCategory` |
| Browser | `packages/core/src/responsive-evidence.ts` | Second `page.evaluate` pass: interactives, overlap pairs, text-clip candidates, touch metrics |
| Node | `packages/core/src/responsive-classify.ts` | Evidence-based classification; limits `ADVANCED_FINDING_LIMIT` / `ADVANCED_ELEMENT_LIMIT` |
| Orchestration | `packages/core/src/detect-responsive.ts` | Called after overflow detection in `scan.ts` |
| JSON | `JsonReportViewport.advancedFindings`, `advancedAnalysis`; summary `advancedFindingCount` | Backward compatible optional fields |
| Exit code | Unchanged | Still `issueCount` (horizontal overflow) + visual failures only |

## Configuration

`ScanOptions.detection?: Partial<DetectionConfig>` — toggles per detector and touch-target thresholds (`touchTargetMinPx`, default 44 at ≤390px width).

## Studio / CLI / HTML

- CLI lists responsive findings separately; documents that they do not change exit code.
- Studio parses `advancedFindings` and shows an advisory list in the findings panel.
- Standalone HTML: extend in `packages/report/src/build-html.ts` when rendering stats (same optional fields).

## Performance

- Overlap uses spatial filtering (fixed/sticky/large/z-index blockers only; skips nested and `.swiper` pairs).
- Caps: 2500 interactives inspected, 200 overlap pairs collected, 150 text candidates, 40 findings reported per viewport.
