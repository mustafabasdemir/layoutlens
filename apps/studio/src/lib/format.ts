export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export function displayUrl(url: string): { host: string; rest: string } {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") {
      const parts = u.pathname.split("/").filter(Boolean);
      return { host: "file://", rest: `…/${parts.slice(-2).join("/")}` };
    }
    return { host: u.host, rest: u.pathname === "/" ? "" : u.pathname };
  } catch {
    return { host: url, rest: "" };
  }
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatPercent(ratio: number, digits = 2): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}
