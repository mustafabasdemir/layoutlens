/** Client-side visual panel logic embedded into offline HTML (plain JS, no imports). */
export function buildVisualPanelClientScript(): string {
  return `
      function dividerPercentFromClientX(clientX, stageEl) {
        var rect = stageEl.getBoundingClientRect();
        if (rect.width <= 0) return 50;
        var ratio = (clientX - rect.left) / rect.width;
        var pct = ratio * 100;
        return Math.min(100, Math.max(0, pct));
      }

      function mountBeforeAfterSlider(sliderPane, vp, onFatalError) {
        var vc = vp.visualCompare;
        var baselineSrc = vc.baselineScreenshot;
        var currentSrc = vp.screenshot;

        var help = document.createElement("p");
        help.className = "compare-help visual-meta";
        text(help, compareHelpText);
        sliderPane.appendChild(help);

        if (vc.diffPixels === 0) {
          var identical = document.createElement("p");
          identical.className = "visual-meta";
          text(identical, compareIdenticalHintText);
          sliderPane.appendChild(identical);
        }

        if (!baselineSrc) {
          var missBase = document.createElement("p");
          missBase.className = "visual-missing";
          text(missBase, missingBaselineMsg);
          sliderPane.appendChild(missBase);
          return { whenReady: function (cb) { cb({ ok: false, message: missingBaselineMsg }); }, applyDivider: function () {} };
        }
        if (!currentSrc) {
          var missCur = document.createElement("p");
          missCur.className = "visual-missing";
          text(missCur, missingCurrentMsg);
          sliderPane.appendChild(missCur);
          return { whenReady: function (cb) { cb({ ok: false, message: missingCurrentMsg }); }, applyDivider: function () {} };
        }

        var labels = document.createElement("div");
        labels.className = "compare-labels";
        var labelBefore = document.createElement("span");
        text(labelBefore, "Before (Baseline)");
        var labelAfter = document.createElement("span");
        text(labelAfter, "After (Current)");
        labels.appendChild(labelBefore);
        labels.appendChild(labelAfter);
        sliderPane.appendChild(labels);

        var stage = document.createElement("div");
        stage.className = "compare-frame ba-slider-stage";
        stage.setAttribute("tabindex", "0");
        stage.setAttribute("role", "group");
        stage.setAttribute("aria-label", "Before and after screenshot comparison");

        var afterImg = document.createElement("img");
        afterImg.className = "compare-layer compare-after";
        afterImg.src = currentSrc;
        afterImg.alt = "After (Current) screenshot";

        var clip = document.createElement("div");
        clip.className = "compare-before-clip";
        var beforeImg = document.createElement("img");
        beforeImg.className = "compare-layer compare-before";
        beforeImg.src = baselineSrc;
        beforeImg.alt = "Before (Baseline) screenshot";
        clip.appendChild(beforeImg);

        var handle = document.createElement("div");
        handle.className = "ba-divider-handle";
        handle.setAttribute("role", "slider");
        handle.setAttribute("aria-label", "Comparison divider");
        handle.setAttribute("aria-valuemin", "0");
        handle.setAttribute("aria-valuemax", "100");
        handle.setAttribute("aria-valuenow", "50");
        var line = document.createElement("div");
        line.className = "ba-divider-line";
        var knob = document.createElement("span");
        knob.className = "ba-divider-knob";
        knob.setAttribute("aria-hidden", "true");
        handle.appendChild(line);
        handle.appendChild(knob);

        stage.appendChild(afterImg);
        stage.appendChild(clip);
        stage.appendChild(handle);
        sliderPane.appendChild(stage);

        var range = document.createElement("input");
        range.type = "range";
        range.min = "0";
        range.max = "100";
        range.value = "50";
        range.className = "ba-range-sync";
        range.setAttribute("aria-label", "Comparison divider position");
        sliderPane.appendChild(range);

        var applyDividerRef = null;
        var dragging = false;

        function setDivider(pct) {
          var clamped = Math.min(100, Math.max(0, pct));
          range.value = String(clamped);
          clip.style.width = clamped + "%";
          handle.style.left = clamped + "%";
          handle.setAttribute("aria-valuenow", String(Math.round(clamped)));
          var w = stage.clientWidth;
          var h = stage.clientHeight;
          if (w > 0 && h > 0) {
            beforeImg.style.width = w + "px";
            beforeImg.style.height = h + "px";
          }
        }

        applyDividerRef = setDivider;

        range.addEventListener("input", function () {
          setDivider(Number(range.value));
        });

        function onPointerMove(clientX) {
          setDivider(dividerPercentFromClientX(clientX, stage));
        }

        handle.addEventListener("pointerdown", function (ev) {
          dragging = true;
          handle.setPointerCapture(ev.pointerId);
          ev.preventDefault();
        });
        handle.addEventListener("pointermove", function (ev) {
          if (!dragging) return;
          onPointerMove(ev.clientX);
        });
        handle.addEventListener("pointerup", function (ev) {
          dragging = false;
          try { handle.releasePointerCapture(ev.pointerId); } catch (e) {}
        });
        handle.addEventListener("pointercancel", function () {
          dragging = false;
        });

        stage.addEventListener("pointerdown", function (ev) {
          if (ev.target === handle || handle.contains(ev.target)) return;
          dragging = true;
          stage.setPointerCapture(ev.pointerId);
          onPointerMove(ev.clientX);
          ev.preventDefault();
        });
        stage.addEventListener("pointermove", function (ev) {
          if (!dragging) return;
          onPointerMove(ev.clientX);
        });
        stage.addEventListener("pointerup", function (ev) {
          dragging = false;
          try { stage.releasePointerCapture(ev.pointerId); } catch (e) {}
        });
        stage.addEventListener("pointercancel", function () {
          dragging = false;
        });

        stage.addEventListener("keydown", function (ev) {
          var step = sliderKeyboardStep;
          var cur = Number(range.value);
          if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
            setDivider(cur - step);
            ev.preventDefault();
          } else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
            setDivider(cur + step);
            ev.preventDefault();
          } else if (ev.key === "Home") {
            setDivider(0);
            ev.preventDefault();
          } else if (ev.key === "End") {
            setDivider(100);
            ev.preventDefault();
          }
        });

        beforeImg.addEventListener("error", function () {
          if (onFatalError) onFatalError(missingBaselineMsg);
        });
        afterImg.addEventListener("error", function () {
          if (onFatalError) onFatalError(missingCurrentMsg);
        });

        function finishSetup(onReady) {
          if (beforeImg.naturalWidth !== afterImg.naturalWidth || beforeImg.naturalHeight !== afterImg.naturalHeight) {
            var mismatchMsg =
              "Incompatible screenshot sizes: baseline " +
              beforeImg.naturalWidth + "×" + beforeImg.naturalHeight +
              " vs current " + afterImg.naturalWidth + "×" + afterImg.naturalHeight +
              ". Recreate the baseline with the same viewport width, height, and device scale.";
            if (onReady) onReady({ ok: false, message: mismatchMsg });
            return;
          }
          stage.style.aspectRatio = beforeImg.naturalWidth + " / " + beforeImg.naturalHeight;
          if (typeof ResizeObserver !== "undefined") {
            new ResizeObserver(function () {
              setDivider(Number(range.value));
            }).observe(stage);
          }
          window.addEventListener("resize", function () {
            setDivider(Number(range.value));
          });
          setDivider(50);
          if (onReady) onReady({ ok: true, aspectRatio: stage.style.aspectRatio });
        }

        var afterReady = false;
        var beforeReady = false;
        var setupDone = false;

        return {
          stage: stage,
          range: range,
          applyDivider: function () {
            if (applyDividerRef) applyDividerRef(Number(range.value));
          },
          whenReady: function (onReady) {
            function finishSetupOnce() {
              if (setupDone) return;
              setupDone = true;
              finishSetup(onReady);
            }
            function markAfterReady() {
              if (afterReady) return;
              afterReady = true;
              if (beforeReady) finishSetupOnce();
            }
            function markBeforeReady() {
              if (beforeReady) return;
              beforeReady = true;
              if (afterReady) finishSetupOnce();
            }
            afterImg.addEventListener("load", markAfterReady);
            beforeImg.addEventListener("load", markBeforeReady);
            if (afterImg.complete && afterImg.naturalWidth > 0) markAfterReady();
            if (beforeImg.complete && beforeImg.naturalWidth > 0) markBeforeReady();
          },
        };
      }

      function createSideBySidePane(vp) {
        var pane = document.createElement("div");
        pane.className = "visual-view-pane visual-view-side-by-side";
        var vc = vp.visualCompare;
        if (!vc.baselineScreenshot) {
          var miss = document.createElement("p");
          miss.className = "visual-missing";
          text(miss, missingBaselineMsg);
          pane.appendChild(miss);
          return pane;
        }
        if (!vp.screenshot) {
          var miss2 = document.createElement("p");
          miss2.className = "visual-missing";
          text(miss2, missingCurrentMsg);
          pane.appendChild(miss2);
          return pane;
        }
        var grid = document.createElement("div");
        grid.className = "visual-side-by-side";
        [["Before (Baseline)", vc.baselineScreenshot], ["After (Current)", vp.screenshot]].forEach(function (pair) {
          var fig = document.createElement("figure");
          var cap = document.createElement("figcaption");
          text(cap, pair[0]);
          fig.appendChild(cap);
          var frame = document.createElement("div");
          frame.className = "compare-frame";
          var img = document.createElement("img");
          img.className = "compare-layer";
          img.src = pair[1];
          img.alt = pair[0] + " screenshot";
          frame.appendChild(img);
          fig.appendChild(frame);
          grid.appendChild(fig);
        });
        pane.appendChild(grid);
        return pane;
      }

      function createDiffPane(vp) {
        var pane = document.createElement("div");
        pane.className = "visual-view-pane visual-view-diff";
        var diffSrc = vp.visualCompare.diffScreenshot;
        if (!diffSrc) {
          var miss = document.createElement("p");
          miss.className = "visual-missing";
          text(miss, missingDiffMsg);
          pane.appendChild(miss);
          return { pane: pane };
        }
        var frame = document.createElement("div");
        frame.className = "compare-frame visual-single-frame";
        var img = document.createElement("img");
        img.className = "compare-layer";
        img.src = diffSrc;
        img.alt = "Pixel difference image";
        img.addEventListener("error", function () {
          var err = document.createElement("p");
          err.className = "visual-missing";
          text(err, missingDiffMsg);
          pane.appendChild(err);
        });
        frame.appendChild(img);
        pane.appendChild(frame);
        img.addEventListener("load", function () {
          frame.style.aspectRatio = img.naturalWidth + " / " + img.naturalHeight;
        });
        return { pane: pane };
      }
`.trim();
}

export function buildSetupVisualRegressionPanelScript(): string {
  return `
      function setupVisualRegressionPanel(visualPanel, vp, shotShell) {
        var vc = vp.visualCompare;
        var vBadge = document.createElement("span");
        vBadge.className = "badge " + (vc.status === "pass" ? "ok" : "high");
        text(vBadge, vc.status === "pass" ? "Pass" : "Fail");
        visualPanel.appendChild(vBadge);

        var stats = document.createElement("p");
        stats.className = "visual-stats";
        text(stats, formatVisualDiffStats(vc.diffPixels, vc.diffPixelRatio != null ? vc.diffPixelRatio : 0));
        visualPanel.appendChild(stats);

        var note = document.createElement("p");
        note.className = "visual-meta";
        text(note, visualDiffNotLayoutText);
        visualPanel.appendChild(note);

        var explain = document.createElement("p");
        explain.className = "visual-meta";
        text(explain, visualDiffExplanationText);
        visualPanel.appendChild(explain);

        var legend = document.createElement("div");
        legend.className = "visual-legend";
        legend.setAttribute("role", "group");
        legend.setAttribute("aria-label", "Difference legend");
        [["changed", "Changed pixels (magenta)"], ["unchanged", "Unchanged (dimmed baseline)"]].forEach(function (pair) {
          var item = document.createElement("span");
          item.className = "visual-legend-item";
          var sw = document.createElement("span");
          sw.className = "visual-legend-swatch " + pair[0];
          sw.setAttribute("aria-hidden", "true");
          item.appendChild(sw);
          var lbl = document.createElement("span");
          text(lbl, pair[1]);
          item.appendChild(lbl);
          legend.appendChild(item);
        });
        visualPanel.appendChild(legend);

        var modeBar = document.createElement("div");
        modeBar.className = "visual-mode-bar";
        modeBar.setAttribute("role", "group");
        modeBar.setAttribute("aria-label", "Screenshot view mode");
        visualPanel.appendChild(modeBar);

        var viewRoot = document.createElement("div");
        viewRoot.className = "visual-view-root";
        visualPanel.appendChild(viewRoot);

        var panelErr = document.createElement("div");
        panelErr.className = "compare-error";
        panelErr.hidden = true;
        visualPanel.appendChild(panelErr);

        function showPanelError(message) {
          panelErr.hidden = false;
          text(panelErr, message);
        }

        var sliderPane = document.createElement("div");
        sliderPane.className = "visual-view-pane visual-view-slider";
        var sliderSetup = mountBeforeAfterSlider(sliderPane, vp, showPanelError);
        var sideBySidePane = createSideBySidePane(vp);
        var diffView = createDiffPane(vp);
        var diffSrc = vc.diffScreenshot || "";

        viewRoot.appendChild(sliderPane);
        viewRoot.appendChild(sideBySidePane);
        viewRoot.appendChild(diffView.pane);

        var activeMode = vc.diffPixels > 0 && diffSrc ? "diff" : "slider";
        var modeButtons = {};

        function setMode(mode) {
          activeMode = mode;
          sliderPane.classList.toggle("active", mode === "slider");
          sideBySidePane.classList.toggle("active", mode === "sideBySide");
          diffView.pane.classList.toggle("active", mode === "diff");
          if (shotShell) {
            shotShell.classList.toggle("slider-focus", mode === "slider");
          }
          visualViewModes.forEach(function (m) {
            var btn = modeButtons[m.id];
            if (btn) btn.setAttribute("aria-pressed", mode === m.id ? "true" : "false");
          });
          if (mode === "slider") {
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                sliderSetup.applyDivider();
              });
            });
          }
        }

        visualViewModes.forEach(function (m) {
          if (m.id === "diff" && !diffSrc) {
            return;
          }
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "visual-mode-btn";
          btn.dataset.visualMode = m.id;
          btn.setAttribute("aria-pressed", activeMode === m.id ? "true" : "false");
          text(btn, m.label);
          btn.addEventListener("click", function () {
            setMode(m.id);
          });
          modeButtons[m.id] = btn;
          modeBar.appendChild(btn);
        });

        sliderSetup.whenReady(function (result) {
          if (!result.ok) {
            showPanelError(result.message || "Comparison unavailable.");
            if (result.message && result.message.indexOf("Incompatible") === -1) {
              sliderPane.classList.remove("active");
            } else {
              viewRoot.hidden = true;
              modeBar.hidden = true;
            }
            return;
          }
          setMode(activeMode);
        });
      }
`.trim();
}
