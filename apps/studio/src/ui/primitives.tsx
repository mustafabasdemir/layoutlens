import type { ButtonHTMLAttributes, ComponentPropsWithRef, KeyboardEvent, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { CLASSIFICATION_LABELS, type FindingClassification } from "@layoutlens/shared";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      {...rest}
      className={["btn", `btn-${variant}`, `btn-${size}`, className].filter(Boolean).join(" ")}
    >
      {icon ? <span className="btn-icon" aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className,
  pressed,
  ...rest
}: ComponentPropsWithRef<"button"> & { label: string; pressed?: boolean; "data-testid"?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
      {...rest}
      className={["icon-btn", className].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
  "aria-labelledby"?: string;
  "aria-label"?: string;
  [data: `data-${string}`]: string | undefined;
}) {
  return (
    <Tag {...rest} className={["card", className].filter(Boolean).join(" ")}>
      {children}
    </Tag>
  );
}

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function SeverityBadge({ severity }: { severity: "high" | "medium" | "low" }) {
  const tone: Tone = severity === "high" ? "danger" : severity === "medium" ? "warning" : "info";
  return (
    <Badge tone={tone}>
      <span className={`dot dot-${tone}`} aria-hidden="true" />
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </Badge>
  );
}

const CLASSIFICATION_TONES: Record<FindingClassification, Tone> = {
  confirmed: "danger",
  potential: "warning",
  "insufficient-evidence": "neutral",
};

export function ClassificationBadge({ classification }: { classification: FindingClassification | undefined }) {
  if (!classification) return <Badge>Unclassified</Badge>;
  return (
    <span className={`badge badge-${CLASSIFICATION_TONES[classification]} badge-outline`} data-classification={classification}>
      {CLASSIFICATION_LABELS[classification]}
    </span>
  );
}

const NOTICE_ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

export function Notice({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: keyof typeof NOTICE_ICONS;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const Icon = NOTICE_ICONS[tone];
  return (
    <div className={`notice notice-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon className="notice-icon" size={16} aria-hidden="true" />
      <div className="notice-body">
        {title ? <p className="notice-title">{title}</p> : null}
        {children ? <div className="notice-text">{children}</div> : null}
      </div>
      {action ? <div className="notice-action">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  actions,
}: {
  icon: ReactNode | null;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon ? <div className="empty-icon" aria-hidden="true">{icon}</div> : null}
      <h3 className="empty-title">{title}</h3>
      {children ? <div className="empty-text">{children}</div> : null}
      {actions ? <div className="empty-actions">{actions}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={["skeleton", className].filter(Boolean).join(" ")} aria-hidden="true" />;
}

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

/** Mutually exclusive buttons (aria-pressed), arrow-key navigable. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
}: {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange(id: T): void;
  size?: "sm" | "md";
}) {
  const enabled = options.filter((o) => !o.disabled);
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const idx = enabled.findIndex((o) => o.id === value);
    const next = enabled[(idx + (e.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length];
    if (next) {
      onChange(next.id);
      const btn = e.currentTarget.querySelector<HTMLButtonElement>(`[data-segment="${next.id}"]`);
      btn?.focus();
    }
    e.preventDefault();
  }
  return (
    <div className={`segmented segmented-${size}`} role="group" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          data-segment={o.id}
          className="segment"
          aria-pressed={o.id === value}
          disabled={o.disabled}
          tabIndex={o.id === value ? 0 : -1}
          onClick={() => onChange(o.id)}
        >
          {o.icon ? <span aria-hidden="true" className="segment-icon">{o.icon}</span> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Metric({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: Tone }) {
  return (
    <div className={`metric${tone ? ` metric-${tone}` : ""}`}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      {hint ? <span className="metric-hint">{hint}</span> : null}
    </div>
  );
}
