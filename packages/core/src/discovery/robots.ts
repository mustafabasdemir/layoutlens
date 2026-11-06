/**
 * Minimal robots.txt gate — User-agent: * rules only, path prefix match.
 */

export interface RobotsRuleResult {
  allowed: boolean;
  line?: string;
}

function parseRobotsTxt(body: string): { disallows: string[] } {
  const disallows: string[] = [];
  const lines = body.split(/\r?\n/);
  let inStarAgent = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#") || line.length === 0) continue;
    const m = /^([^:]+):\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === "user-agent") {
      inStarAgent = val === "*";
    } else if (inStarAgent && key === "disallow") {
      if (val.length > 0) disallows.push(val);
    } else if (key === "user-agent") {
      /* another agent block ends * block */
      inStarAgent = false;
    }
  }
  return { disallows };
}

export function isPathAllowedByRobots(pathname: string, disallows: readonly string[]): boolean {
  for (const rule of disallows) {
    const prefix = rule.startsWith("/") ? rule : `/${rule}`;
    if (pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)) {
      return false;
    }
    if (prefix === "/" && pathname !== "") return false;
  }
  return true;
}

export async function fetchRobotsDisallows(origin: string, signal?: AbortSignal): Promise<string[]> {
  const robotsUrl = new URL("/robots.txt", origin);
  try {
    const res = await fetch(robotsUrl, {
      redirect: "follow",
      headers: { "user-agent": "LayoutLens/0.1 (layout scan)" },
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return [];
    const text = await res.text();
    return parseRobotsTxt(text).disallows;
  } catch {
    return [];
  }
}
