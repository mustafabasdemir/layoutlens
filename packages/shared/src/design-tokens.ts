/**
 * LayoutLens design tokens shared by Studio and the offline HTML report.
 * Components reference CSS custom properties (`var(--ll-*)`), never raw hex values.
 */
export interface ThemePalette {
  bg: string;
  surface: string;
  surfaceElevated: string;
  surfaceHover: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  accentContrast: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export const DARK_PALETTE: ThemePalette = {
  bg: "#09090B",
  surface: "#111115",
  surfaceElevated: "#18181F",
  surfaceHover: "#22222B",
  border: "#292933",
  text: "#F4F4F5",
  textSecondary: "#A1A1AA",
  textMuted: "#71717A",
  accent: "#8B5CF6",
  accentHover: "#7C3AED",
  accentContrast: "#FFFFFF",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",
  info: "#3B82F6",
};

export const LIGHT_PALETTE: ThemePalette = {
  bg: "#FAFAFA",
  surface: "#FFFFFF",
  surfaceElevated: "#F4F4F5",
  surfaceHover: "#E9E9EC",
  border: "#E4E4E7",
  text: "#09090B",
  textSecondary: "#52525B",
  textMuted: "#71717A",
  accent: "#7C3AED",
  accentHover: "#6D28D9",
  accentContrast: "#FFFFFF",
  success: "#16A34A",
  warning: "#B45309",
  danger: "#DC2626",
  info: "#2563EB",
};

export const FONT_SANS =
  '"Geist", "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const FONT_MONO =
  '"Geist Mono", ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace';

function paletteVars(p: ThemePalette): string {
  return [
    `--ll-bg: ${p.bg};`,
    `--ll-surface: ${p.surface};`,
    `--ll-surface-elevated: ${p.surfaceElevated};`,
    `--ll-surface-hover: ${p.surfaceHover};`,
    `--ll-border: ${p.border};`,
    `--ll-text: ${p.text};`,
    `--ll-text-secondary: ${p.textSecondary};`,
    `--ll-text-muted: ${p.textMuted};`,
    `--ll-accent: ${p.accent};`,
    `--ll-accent-hover: ${p.accentHover};`,
    `--ll-accent-contrast: ${p.accentContrast};`,
    `--ll-success: ${p.success};`,
    `--ll-warning: ${p.warning};`,
    `--ll-danger: ${p.danger};`,
    `--ll-info: ${p.info};`,
  ].join("\n  ");
}

const STATIC_VARS = [
  `--ll-font-sans: ${FONT_SANS};`,
  `--ll-font-mono: ${FONT_MONO};`,
  "--ll-radius-sm: 6px;",
  "--ll-radius-md: 8px;",
  "--ll-radius-lg: 12px;",
  "--ll-space-1: 4px;",
  "--ll-space-2: 8px;",
  "--ll-space-3: 12px;",
  "--ll-space-4: 16px;",
  "--ll-space-5: 20px;",
  "--ll-space-6: 24px;",
  "--ll-space-8: 32px;",
  "--ll-space-10: 40px;",
  "--ll-text-xs: 12px;",
  "--ll-text-sm: 13px;",
  "--ll-text-md: 14px;",
  "--ll-text-lg: 16px;",
  "--ll-text-xl: 20px;",
  "--ll-text-2xl: 28px;",
  "--ll-text-3xl: 36px;",
  "--ll-duration: 180ms;",
  "--ll-ease: cubic-bezier(0.2, 0, 0, 1);",
  "--ll-shadow-sm: 0 1px 2px rgb(0 0 0 / 0.25);",
  "--ll-shadow-md: 0 8px 24px rgb(0 0 0 / 0.28);",
  "--ll-focus-ring: 0 0 0 2px var(--ll-bg), 0 0 0 4px var(--ll-accent);",
].join("\n  ");

/**
 * CSS custom properties for both themes. Dark is the default; `data-theme="light"`
 * on the root element switches to the light palette.
 */
export function designTokensCss(): string {
  return `:root {
  color-scheme: dark;
  ${paletteVars(DARK_PALETTE)}
  ${STATIC_VARS}
}
:root[data-theme="light"] {
  color-scheme: light;
  ${paletteVars(LIGHT_PALETTE)}
  --ll-shadow-sm: 0 1px 2px rgb(0 0 0 / 0.06);
  --ll-shadow-md: 0 8px 24px rgb(0 0 0 / 0.08);
}
@media (prefers-reduced-motion: reduce) {
  :root { --ll-duration: 0ms; }
}`;
}
