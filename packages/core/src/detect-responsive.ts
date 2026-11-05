import type { Page } from "playwright";
import {
  mergeDetectionConfig,
  type AdvancedFinding,
  type AdvancedViewportAnalysis,
  type DetectionConfig,
} from "@layoutlens/shared";
import { ADVANCED_ELEMENT_LIMIT, classifyResponsiveEvidence } from "./responsive-classify.js";
import { collectResponsiveEvidence } from "./responsive-evidence.js";

export async function detectResponsiveIssues(
  page: Page,
  viewportWidth: number,
  viewportHeight: number,
  detection?: Partial<DetectionConfig>,
): Promise<{ findings: AdvancedFinding[]; analysis: AdvancedViewportAnalysis }> {
  const config = mergeDetectionConfig(detection);
  const evidence = await page.evaluate(collectResponsiveEvidence, {
    viewportWidth,
    viewportHeight,
    maxElements: ADVANCED_ELEMENT_LIMIT,
    touchTargetMinPx: config.touchTargetMinPx,
    touchTargetSpacingPx: config.touchTargetSpacingPx,
    touchTargetsEnabled: config.touchTargets && viewportWidth <= config.touchTargetMaxViewport,
    overlapEnabled: config.overlap,
    textClippingEnabled: config.textClipping,
    offscreenEnabled: config.offscreenControls,
  });
  return classifyResponsiveEvidence(evidence, config);
}
