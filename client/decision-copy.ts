import type { NeedsYouRequest } from "../shared/needs-you";

/** Keep the authored title in details; remove only balanced trailing notes at rest. */
export function decisionTitle(title: string): string {
  let text = title.trim();
  while (text.endsWith(")")) {
    let depth = 0,
      start = -1;
    for (let i = text.length - 1; i >= 0; i--) {
      if (text[i] === ")") depth++;
      if (text[i] === "(" && --depth === 0) {
        start = i;
        break;
      }
    }
    if (start <= 0 || !/\s/.test(text[start - 1]!)) break;
    text = text.slice(0, start).trimEnd();
  }
  return text || title;
}

export function relativeDecisionTime(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  return minutes < 1
    ? "just now"
    : minutes < 60
      ? `${minutes} min`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h`
        : `${Math.floor(minutes / 1440)}d`;
}

export function decisionClock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function decisionStateLabel(
  request: NeedsYouRequest,
  now = Date.now(),
): string {
  switch (request.state) {
    case "new":
      return "New";
    case "seen":
      return `Waiting ${relativeDecisionTime(request.detectedAt, now)}`;
    case "answer-sent": {
      const age = relativeDecisionTime(
        request.submissions.at(-1)?.recordedAt ?? request.updatedAt,
        now,
      );
      return `Answered ${age}${age === "just now" ? "" : " ago"} · waiting for the first mate`;
    }
    case "delivery-uncertain":
      return "Delivery not confirmed";
    case "snoozed":
      return `Back ${new Date(request.snoozedUntil ?? now).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${decisionClock(request.snoozedUntil ?? now)}`;
    case "resolved":
      return "Settled";
  }
}

/** Pick the darker theme token for legible text on the filled amber signal in either theme. */
export function decisionSignalInk(surface: string, foreground: string): string {
  const luminance = (color: string) => {
    const hex = color.replace("#", "");
    const expanded =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex;
    const rgb = [0, 2, 4].map((i) => parseInt(expanded.slice(i, i + 2), 16));
    return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  };
  return luminance(surface) < luminance(foreground) ? surface : foreground;
}

export function decisionLinkLabel(url: string): string {
  const github =
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/(discussions|pull|issues)\/(\d+)/.exec(
      url,
    );
  if (github)
    return `${github[1] === "discussions" ? "Discussion" : github[1] === "pull" ? "PR" : "Issue"} #${github[2]}`;
  return url.split(/[\\/]/).filter(Boolean).at(-1) ?? url;
}

/** Session order is append-only: acknowledging, answering and snoozing cannot move a row. */
export function stableDecisionOrder(
  ids: readonly string[],
  requests: readonly NeedsYouRequest[],
): string[] {
  const known = new Set(ids);
  return [...ids, ...requests.filter((r) => !known.has(r.id)).map((r) => r.id)];
}

export function nextWaitingDecision(
  ids: readonly string[],
  current: string,
  requests: readonly NeedsYouRequest[],
) {
  const after = ids.indexOf(current) + 1;
  return [...ids.slice(after), ...ids.slice(0, after)]
    .filter((id) => id !== current)
    .map((id) => requests.find((r) => r.id === id))
    .find((r) => r?.state === "new" || r?.state === "seen");
}

export function thisEvening(now: number): number {
  const date = new Date(now);
  date.setHours(18, 0, 0, 0);
  if (date.getTime() <= now) date.setDate(date.getDate() + 1);
  return date.getTime();
}
