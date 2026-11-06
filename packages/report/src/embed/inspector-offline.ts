/** Plain JS for offline HTML inspector — inlined into build-html (no imports). */
export function buildInspectorOfflineScript(): string {
  return `
      function llInspectorMapPointerToLayout(relX, relY, displayW, displayH, naturalW, naturalH, vpW, vpH) {
        if (!(displayW > 0 && displayH > 0 && naturalW > 0 && naturalH > 0 && vpW > 0)) {
          return { x: NaN, y: NaN };
        }
        var fx = relX / displayW;
        var fy = relY / displayH;
        var capturedWidth = vpW;
        var scale = naturalW / capturedWidth;
        var capturedHeight = naturalH / scale;
        return { x: fx * capturedWidth, y: fy * capturedHeight };
      }

      function llInspectorHitTest(elements, hitTest, x, y) {
        function inBox(px, py, box) {
          return px >= box.x && py >= box.y && px <= box.x + box.width && py <= box.y + box.height;
        }
        var containingIds = [];
        for (var i = 0; i < elements.length; i++) {
          var el = elements[i];
          var vb = el.visibleBox;
          if (vb && vb.width > 0 && vb.height > 0) {
            if (inBox(x, y, vb)) containingIds.push(el.id);
            continue;
          }
          if (inBox(x, y, el.boundingBox)) containingIds.push(el.id);
        }
        var gridOrderedIds = null;
        if (hitTest && hitTest.samples && hitTest.samples.length) {
          var best = null;
          for (var si = 0; si < hitTest.samples.length; si++) {
            var s = hitTest.samples[si];
            var dx = s.x - x;
            var dy = s.y - y;
            var dist = dx * dx + dy * dy;
            if (!best || dist < best.dist) best = { dist: dist, sample: s };
          }
          if (best && best.dist <= hitTest.stepPx * hitTest.stepPx * 2) {
            gridOrderedIds = best.sample.topIds.slice();
          }
        }
        var uncertain = containingIds.length > 1 || (gridOrderedIds && gridOrderedIds.length > 1 && containingIds.length > 0);
        return { containingIds: containingIds, gridOrderedIds: gridOrderedIds, uncertain: uncertain };
      }

      function llInspectorById(elements) {
        var m = {};
        for (var i = 0; i < elements.length; i++) m[elements[i].id] = elements[i];
        return m;
      }

      function llInteractiveNode(n) {
        var t = n.tagName || "";
        if (t === "a" || t === "button" || t === "input" || t === "select" || t === "textarea" || t === "label" || t === "option" || t === "summary") return true;
        var pe = n.computed && n.computed.pointerEvents;
        if (pe && pe !== "none" && pe !== "auto") return true;
        return false;
      }

      function llAreaOf(n) {
        var b = n.visibleBox && n.visibleBox.width > 0 && n.visibleBox.height > 0 ? n.visibleBox : n.boundingBox;
        return Math.max(0, b.width) * Math.max(0, b.height);
      }

      function llContainingIdsAtPoint(elements, x, y) {
        function inBox(px, py, box) {
          return px >= box.x && py >= box.y && px <= box.x + box.width && py <= box.y + box.height;
        }
        var ids = [];
        for (var i = 0; i < elements.length; i++) {
          var el = elements[i];
          var vb = el.visibleBox;
          if (vb && vb.width > 0 && vb.height > 0 && inBox(x, y, vb)) {
            ids.push(el.id);
            continue;
          }
          if ((!vb || vb.width <= 0 || vb.height <= 0) && inBox(x, y, el.boundingBox)) ids.push(el.id);
        }
        return ids;
      }

      function llPickInspectorTarget(hit, byId, elements, layoutX, layoutY) {
        var containing = llContainingIdsAtPoint(elements, layoutX, layoutY);
        var set = {};
        for (var j = 0; j < containing.length; j++) set[containing[j]] = true;
        var primaryId = null;
        var uncertain = false;
        var gridOrderedIds = hit.gridOrderedIds;
        if (gridOrderedIds && gridOrderedIds.length) {
          var ordered = [];
          for (var gi = 0; gi < gridOrderedIds.length; gi++) {
            if (set[gridOrderedIds[gi]]) ordered.push(gridOrderedIds[gi]);
          }
          if (ordered.length === 1) {
            primaryId = ordered[0];
            uncertain = containing.length > 1;
          } else if (ordered.length > 1) {
            primaryId = ordered[0];
            uncertain = true;
          }
        }
        if (!primaryId && containing.length === 1) {
          primaryId = containing[0];
          uncertain = false;
        }
        if (!primaryId && containing.length > 0) {
          var bestId = null;
          var bestScore = -1;
          for (var k = 0; k < containing.length; k++) {
            var id = containing[k];
            var n = byId[id];
            if (!n) continue;
            var inter = llInteractiveNode(n) ? 1000 : 0;
            var depthScore = n.depth * 10;
            var invA = 1 / (llAreaOf(n) + 1);
            var sc = inter + depthScore + invA;
            if (sc > bestScore) { bestScore = sc; bestId = id; }
          }
          primaryId = bestId;
          uncertain = containing.length > 1;
        }
        var candidates = [];
        if (gridOrderedIds && gridOrderedIds.length) {
          for (var oi = 0; oi < gridOrderedIds.length; oi++) {
            if (set[gridOrderedIds[oi]]) candidates.push(gridOrderedIds[oi]);
          }
        }
        if (!candidates.length && containing.length) {
          containing.sort(function (a, b) {
            var na = byId[a];
            var nb = byId[b];
            if (!na || !nb) return 0;
            if (nb.depth !== na.depth) return nb.depth - na.depth;
            return llAreaOf(na) - llAreaOf(nb);
          });
          candidates = containing.slice();
        }
        if (primaryId && candidates.indexOf(primaryId) < 0) {
          candidates = [primaryId].concat(candidates.filter(function (x) { return x !== primaryId; }));
        }
        return { primaryId: primaryId, candidates: candidates, uncertain: uncertain };
      }

      function llMapBoxToOverlayRect(box, vpW, vpH, natW, natH) {
        if (!(vpW > 0 && natW > 0 && natH > 0)) return null;
        var scale = natW / vpW;
        var capW = vpW;
        var capH = natH / scale;
        var left = Math.max(0, box.x);
        var top = Math.max(0, box.y);
        var right = Math.min(capW, box.x + box.width);
        var bottom = Math.min(capH, box.y + box.height);
        if (right <= left || bottom <= top) return null;
        return {
          leftPct: (left / capW) * 100,
          topPct: (top / capH) * 100,
          widthPct: ((right - left) / capW) * 100,
          heightPct: ((bottom - top) / capH) * 100,
        };
      }

      function llFindFindingRowByInspectorId(findingId) {
        if (!findingId) return null;
        var els = document.querySelectorAll(".finding[data-inspector-finding-id]");
        for (var i = 0; i < els.length; i++) {
          if (els[i].getAttribute("data-inspector-finding-id") === findingId) return els[i];
        }
        return null;
      }

      function llMountInspector(shell, vp, vpIndex) {
        var snapshot = vp.inspector;
        var bar = document.createElement("div");
        bar.className = "ll-inspector-bar";
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ll-inspector-toggle";
        var panel = document.createElement("div");
        panel.className = "ll-inspector-panel hidden";
        panel.setAttribute("data-vp-index", String(vpIndex));

        var img = shell.querySelector("img");
        var overlays = shell.querySelector(".shot-overlays");
        if (!img || !overlays || !snapshot || !snapshot.elements || snapshot.elements.length === 0) {
          text(btn, "Inspector unavailable");
          btn.disabled = true;
          btn.setAttribute("aria-pressed", "false");
          var why = document.createElement("span");
          why.className = "ll-inspector-meta";
          text(why, snapshot && snapshot.elements && snapshot.elements.length === 0 ? "Empty snapshot" : "No snapshot in report");
          bar.appendChild(btn);
          bar.appendChild(why);
          shell.appendChild(bar);
          shell.appendChild(panel);
          return;
        }

        var mode = false;
        var hoverLayer = document.createElement("div");
        hoverLayer.className = "ll-inspector-layer";
        hoverLayer.setAttribute("aria-hidden", "true");
        overlays.parentElement.insertBefore(hoverLayer, overlays.nextSibling);
        var selLayer = document.createElement("div");
        selLayer.className = "ll-inspector-layer";
        selLayer.setAttribute("aria-hidden", "true");
        overlays.parentElement.insertBefore(selLayer, hoverLayer.nextSibling);

        shell.appendChild(bar);
        shell.appendChild(panel);

        var byId = llInspectorById(snapshot.elements);
        var hoverId = null;
        var selectedId = null;
        var candidateIds = [];
        var candIdx = 0;
        var hitUncertain = false;
        var meta = snapshot.meta || {};

        function setMode(on) {
          mode = on;
          btn.setAttribute("aria-pressed", on ? "true" : "false");
          shell.classList.toggle("ll-inspector-on", on);
          text(btn, on ? "Inspector on" : "Inspector off");
          if (!on) {
            hoverLayer.innerHTML = "";
            selLayer.innerHTML = "";
            panel.classList.add("hidden");
            hoverId = null;
          }
        }

        function boxForNode(n) {
          return n.visibleBox && n.visibleBox.width > 0 && n.visibleBox.height > 0 ? n.visibleBox : n.boundingBox;
        }

        function drawBox(layer, rect, cls) {
          if (!rect) return;
          var d = document.createElement("div");
          d.className = "ll-inspector-outline " + cls;
          d.style.left = rect.leftPct + "%";
          d.style.top = rect.topPct + "%";
          d.style.width = rect.widthPct + "%";
          d.style.height = rect.heightPct + "%";
          layer.appendChild(d);
        }

        function redrawOverlays() {
          hoverLayer.innerHTML = "";
          selLayer.innerHTML = "";
          if (!mode) return;
          var natW = img.naturalWidth;
          var natH = img.naturalHeight;
          if (hoverId && byId[hoverId]) {
            var hr = llMapBoxToOverlayRect(boxForNode(byId[hoverId]), vp.width, vp.viewportHeight, natW, natH);
            drawBox(hoverLayer, hr, "is-hover");
          }
          if (selectedId && byId[selectedId]) {
            var sr = llMapBoxToOverlayRect(boxForNode(byId[selectedId]), vp.width, vp.viewportHeight, natW, natH);
            drawBox(selLayer, sr, "is-selected");
          }
        }

        function renderPanel(id) {
          panel.innerHTML = "";
          if (!id || !byId[id]) {
            panel.classList.add("hidden");
            return;
          }
          panel.classList.remove("hidden");
          var n = byId[id];
          var h = document.createElement("h4");
          text(h, "Element");
          panel.appendChild(h);
          if (hitUncertain) {
            var warn = document.createElement("p");
            warn.className = "ll-inspector-warn";
            text(warn, "Ambiguous hit — coarse grid + geometry; use Next target to cycle candidates.");
            panel.appendChild(warn);
          }
          var pre = document.createElement("pre");
          pre.className = "ll-inspector-pre";
          var lines = [
            "tag: " + n.tagName,
            "id: " + n.id,
            "selector: " + n.selector,
            "matches: " + n.selectorMatches,
            "bounds: " + JSON.stringify(n.boundingBox),
            "visible: " + JSON.stringify(n.visibleBox),
            "scroll: " + n.scrollWidth + "×" + n.scrollHeight,
            "client: " + n.clientWidth + "×" + n.clientHeight
          ];
          if (meta.truncated) {
            lines.push("snapshot: truncated (" + (meta.elementsOmitted || 0) + " element(s) omitted)");
          }
          if (n.relatedFindingIds && n.relatedFindingIds.length) {
            lines.push("related findings: " + n.relatedFindingIds.join(", "));
          }
          text(pre, lines.join(String.fromCharCode(10)));
          panel.appendChild(pre);

          if (n.relatedFindingIds && n.relatedFindingIds.length) {
            var relWrap = document.createElement("div");
            relWrap.className = "ll-inspector-related";
            var rh = document.createElement("div");
            rh.className = "ll-inspector-related-title";
            text(rh, "Related findings");
            relWrap.appendChild(rh);
            for (var ri = 0; ri < n.relatedFindingIds.length; ri++) {
              (function (fid) {
                var row = llFindFindingRowByInspectorId(fid);
                var rb = document.createElement("button");
                rb.type = "button";
                rb.className = "ll-inspector-related-btn";
                text(rb, row ? "Scroll to finding" : ("Id " + fid + " (not in this list)"));
                rb.disabled = !row;
                rb.addEventListener("click", function () {
                  if (!row) return;
                  row.scrollIntoView({ block: "nearest", behavior: "smooth" });
                  row.click();
                });
                relWrap.appendChild(rb);
              })(n.relatedFindingIds[ri]);
            }
            panel.appendChild(relWrap);
          }

          var st = document.createElement("details");
          st.open = true;
          var sum = document.createElement("summary");
          text(sum, "Computed styles (captured)");
          st.appendChild(sum);
          var ul = document.createElement("ul");
          ul.className = "ll-inspector-styles";
          var keys = Object.keys(n.computed || {}).sort();
          if (!keys.length) {
            var empty = document.createElement("li");
            text(empty, "No style keys in this report.");
            ul.appendChild(empty);
          }
          for (var ki = 0; ki < keys.length; ki++) {
            var li = document.createElement("li");
            text(li, keys[ki] + ": " + n.computed[keys[ki]]);
            ul.appendChild(li);
          }
          st.appendChild(ul);
          panel.appendChild(st);

          if (n.parentId && byId[n.parentId]) {
            var pb = document.createElement("button");
            pb.type = "button";
            pb.className = "ll-inspector-parent";
            text(pb, "Parent: " + byId[n.parentId].tagName);
            pb.addEventListener("click", function () {
              selectedId = n.parentId;
              candIdx = 0;
              redrawOverlays();
              renderPanel(selectedId);
            });
            panel.appendChild(pb);
          }

          if (candidateIds.length > 1) {
            var nb = document.createElement("button");
            nb.type = "button";
            nb.className = "ll-inspector-next";
            text(nb, "Next target (" + (candIdx + 1) + "/" + candidateIds.length + ")");
            nb.addEventListener("click", function () {
              candIdx = (candIdx + 1) % candidateIds.length;
              selectedId = candidateIds[candIdx];
              redrawOverlays();
              renderPanel(selectedId);
              text(nb, "Next target (" + (candIdx + 1) + "/" + candidateIds.length + ")");
            });
            panel.appendChild(nb);
          }
        }

        text(btn, "Inspector off");
        btn.addEventListener("click", function () { setMode(!mode); redrawOverlays(); });

        img.addEventListener("mousemove", function (e) {
          if (!mode) return;
          var r = img.getBoundingClientRect();
          var pt = llInspectorMapPointerToLayout(e.clientX - r.left, e.clientY - r.top, r.width, r.height, img.naturalWidth, img.naturalHeight, vp.width, vp.viewportHeight);
          if (!isFinite(pt.x)) return;
          var hit = llInspectorHitTest(snapshot.elements, snapshot.hitTest, pt.x, pt.y);
          var pick = llPickInspectorTarget(hit, byId, snapshot.elements, pt.x, pt.y);
          hoverId = pick.primaryId;
          redrawOverlays();
        });

        img.addEventListener("mouseleave", function () {
          if (!mode) return;
          hoverId = null;
          redrawOverlays();
        });

        img.addEventListener("click", function (e) {
          if (!mode) return;
          e.preventDefault();
          e.stopPropagation();
          var r = img.getBoundingClientRect();
          var pt = llInspectorMapPointerToLayout(e.clientX - r.left, e.clientY - r.top, r.width, r.height, img.naturalWidth, img.naturalHeight, vp.width, vp.viewportHeight);
          if (!isFinite(pt.x)) return;
          var hit = llInspectorHitTest(snapshot.elements, snapshot.hitTest, pt.x, pt.y);
          var pick = llPickInspectorTarget(hit, byId, snapshot.elements, pt.x, pt.y);
          candidateIds = pick.candidates.length ? pick.candidates : (pick.primaryId ? [pick.primaryId] : []);
          candIdx = 0;
          selectedId = pick.primaryId || candidateIds[0] || null;
          hitUncertain = pick.uncertain;
          redrawOverlays();
          renderPanel(selectedId);
        });

        document.addEventListener("keydown", function (e) {
          if (e.key === "Escape" && mode) {
            setMode(false);
          }
        });

        img.addEventListener("load", redrawOverlays);
        window.addEventListener("resize", redrawOverlays);

        bar.appendChild(btn);
        var hint = document.createElement("span");
        hint.className = "ll-inspector-meta";
        text(hint, "Local snapshot · Esc exits · not pixel-perfect DOM");
        bar.appendChild(hint);
      }
`;
}
