import { useMemo } from "react";
import { Copy } from "lucide-react";
import type { JsonReport, JsonReportViewport } from "@layoutlens/shared";
import {
  INSPECTOR_COMPUTED_STYLE_KEYS,
  mapBoxToScreenshot,
  type InspectorElementNode,
  type InspectorSnapshot,
  type OverlayMapping,
} from "@layoutlens/shared";
import { shortInspectorSelector, workspaceKeyForFindingId } from "../../lib/inspector-related";
import { Badge, Button } from "../../ui/primitives";

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch {
      /* ignore */
    }
  }
}

function styleSectionTitle(key: string): string {
  if (key === "boxSizing") return "box-sizing";
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim();
}

function screenshotStatusForInspector(
  node: InspectorElementNode,
  viewport: JsonReportViewport,
  natural: { naturalWidth: number; naturalHeight: number },
): { mapping: OverlayMapping; label: string } {
  const box =
    node.visibleBox.width > 0 && node.visibleBox.height > 0 ? node.visibleBox : node.boundingBox;
  const mapping = mapBoxToScreenshot(box, viewport, {
    naturalWidth: natural.naturalWidth,
    naturalHeight: natural.naturalHeight,
  });
  let label = "Visible in capture";
  if (mapping.status === "clipped") label = "Partially visible (clipped to viewport)";
  if (mapping.status === "outside") label = "Outside captured viewport";
  if (mapping.status === "unmappable") label = "Could not map to screenshot";
  return { mapping, label };
}

export function ElementInspectorPanel({
  snapshot,
  node,
  report,
  viewport,
  screenshotNatural,
  hitUncertain,
  onSelectFinding,
  onPickParent,
}: {
  snapshot: InspectorSnapshot;
  node: InspectorElementNode;
  report: JsonReport;
  viewport: JsonReportViewport;
  screenshotNatural: { naturalWidth: number; naturalHeight: number } | null;
  hitUncertain: boolean;
  onSelectFinding(key: string): void;
  onPickParent(id: string | null): void;
}) {
  const byId = useMemo(() => new Map(snapshot.elements.map((e) => [e.id, e] as const)), [snapshot.elements]);

  const ancestors = useMemo((): InspectorElementNode[] => {
    const out: InspectorElementNode[] = [];
    let pid: string | null = node.parentId;
    const guard = 64;
    let steps = 0;
    while (pid && steps++ < guard) {
      const p = byId.get(pid);
      if (!p) break;
      out.push(p);
      pid = p.parentId;
    }
    return out;
  }, [byId, node.parentId]);

  const shot = screenshotNatural ? screenshotStatusForInspector(node, viewport, screenshotNatural) : null;

  const groups = useMemo(() => {
    const layout = [
      "display",
      "position",
      "boxSizing",
      "width",
      "height",
      "minWidth",
      "maxWidth",
      "minHeight",
      "maxHeight",
    ] as const;
    const spacing = [
      "marginTop",
      "marginRight",
      "marginBottom",
      "marginLeft",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
    ] as const;
    const overflow = [
      "overflowX",
      "overflowY",
    ] as const;
    const positioning = ["top", "right", "bottom", "left", "zIndex", "transform"] as const;
    const flexGrid = [
      "flexDirection",
      "flexWrap",
      "justifyContent",
      "alignItems",
      "gridTemplateColumns",
    ] as const;
    const text = ["fontSize", "lineHeight", "whiteSpace", "textOverflow", "overflowWrap"] as const;
    const vis = ["visibility", "opacity", "pointerEvents"] as const;

    const pick = (keys: readonly string[]) =>
      keys
        .filter((k) => INSPECTOR_COMPUTED_STYLE_KEYS.includes(k as (typeof INSPECTOR_COMPUTED_STYLE_KEYS)[number]))
        .map((k) => {
          const key = k as keyof typeof node.computed;
          const val = node.computed[key];
          return val ? { k: key, val } : null;
        })
        .filter((x): x is { k: keyof typeof node.computed; val: string } => x !== null);

    return [
      { title: "Layout", rows: pick(layout) },
      { title: "Spacing", rows: pick(spacing) },
      { title: "Overflow", rows: pick(overflow) },
      { title: "Positioning", rows: pick(positioning) },
      { title: "Flex / grid", rows: pick(flexGrid) },
      { title: "Typography", rows: pick(text) },
      { title: "Visibility", rows: pick(vis) },
    ].filter((g) => g.rows.length > 0);
  }, [node.computed]);

  return (
    <div className="inspector-panel" data-testid="element-inspector-panel">
      {hitUncertain ? (
        <p className="inspector-hint" role="status">
          Stacking order at this point is uncertain — multiple elements overlap. Values shown are from the selected candidate.
        </p>
      ) : null}
      <details open className="inspector-section">
        <summary>Element identity</summary>
        <dl className="inspector-dl">
          <div>
            <dt>Tag</dt>
            <dd>
              <code>{node.tagName}</code>
            </dd>
          </div>
          <div>
            <dt>Inspector id</dt>
            <dd>
              <code>{node.id}</code>
            </dd>
          </div>
          <div>
            <dt>Selector</dt>
            <dd className="inspector-selector-wrap">
              <code className="inspector-selector">{node.selector}</code>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                icon={<Copy size={14} />}
                onClick={() => void copyText(node.selector)}
              >
                Copy
              </Button>
            </dd>
          </div>
          <div>
            <dt>Selector matches</dt>
            <dd>{node.selectorMatches}</dd>
          </div>
        </dl>
      </details>

      <details open className="inspector-section">
        <summary>Geometry (CSS px, layout viewport)</summary>
        <p className="inspector-note">Recorded at scan time — scroll position was at the top of the page.</p>
        <dl className="inspector-dl">
          <div>
            <dt>Bounding box</dt>
            <dd>
              x {node.boundingBox.x}, y {node.boundingBox.y}, w {node.boundingBox.width}, h {node.boundingBox.height}
            </dd>
          </div>
          <div>
            <dt>Visible in viewport</dt>
            <dd>
              x {node.visibleBox.x}, y {node.visibleBox.y}, w {node.visibleBox.width}, h {node.visibleBox.height}
            </dd>
          </div>
          <div>
            <dt>Scroll / client</dt>
            <dd>
              scroll {node.scrollWidth}×{node.scrollHeight} · client {node.clientWidth}×{node.clientHeight}
            </dd>
          </div>
        </dl>
      </details>

      {groups.map((g) => (
        <details key={g.title} className="inspector-section">
          <summary>Computed styles — {g.title}</summary>
          <p className="inspector-note">Read-only values captured during the scan (not a live stylesheet).</p>
          <table className="inspector-table">
            <tbody>
              {g.rows.map(({ k, val }) => (
                <tr key={String(k)}>
                  <th scope="row">{styleSectionTitle(String(k))}</th>
                  <td>
                    <code>{val}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}

      <details open className="inspector-section">
        <summary>Related findings</summary>
        {node.relatedFindingIds.length === 0 ? (
          <p className="inspector-muted">No linked findings for this element.</p>
        ) : (
          <ul className="inspector-related">
            {node.relatedFindingIds.map((fid) => {
              const key = workspaceKeyForFindingId(report, viewport.width, fid);
              return (
                <li key={fid}>
                  <code className="inspector-fid">{fid}</code>
                  {key ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => onSelectFinding(key)}>
                      Open in list
                    </Button>
                  ) : (
                    <Badge tone="warning">Not in this report</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </details>

      <details open className="inspector-section">
        <summary>Parent hierarchy</summary>
        {ancestors.length === 0 ? (
          <p className="inspector-muted">No captured ancestors (root or truncated snapshot).</p>
        ) : (
          <ol className="inspector-ancestors">
            {ancestors.map((a) => (
              <li key={a.id}>
                <Button type="button" size="sm" variant="ghost" onClick={() => onPickParent(a.id)}>
                  <code>{a.tagName}</code> <span className="inspector-muted">{shortInspectorSelector(a.selector, 48)}</span>
                </Button>
              </li>
            ))}
          </ol>
        )}
      </details>

      {shot ? (
        <details open className="inspector-section">
          <summary>Screenshot evidence</summary>
          <p className="inspector-note">{shot.label}</p>
          {shot.mapping.status === "visible" || shot.mapping.status === "clipped" ? (
            <p className="inspector-muted">
              Outline maps to {shot.mapping.rect.leftPct.toFixed(1)}%, {shot.mapping.rect.topPct.toFixed(1)}% (
              {shot.mapping.rect.widthPct.toFixed(1)}% × {shot.mapping.rect.heightPct.toFixed(1)}%)
            </p>
          ) : (
            <p className="inspector-muted">{shot.mapping.reason}</p>
          )}
        </details>
      ) : null}

      <details open className="inspector-section">
        <summary>Capture metadata</summary>
        <dl className="inspector-dl">
          <div>
            <dt>Elements stored</dt>
            <dd>
              {snapshot.meta.elementCount}
              {snapshot.meta.truncated ? " (truncated)" : ""}
            </dd>
          </div>
          <div>
            <dt>Collection time</dt>
            <dd>{snapshot.meta.collectionDurationMs} ms</dd>
          </div>
          <div>
            <dt>Device pixel ratio</dt>
            <dd>{snapshot.meta.devicePixelRatio}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
