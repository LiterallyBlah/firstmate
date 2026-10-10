/** Split limits in layout points; the saved fraction still describes the whole surface. */
export const HANDLE_WIDTH = 18;
export const MIN_CHAT_WIDTH = 320;
export const MIN_CREW_WIDTH = 300;
export const MIN_SPLIT_WIDTH = MIN_CHAT_WIDTH + HANDLE_WIDTH + MIN_CREW_WIDTH;

export function shareLimits(totalWidth: number): { min: number; max: number } {
  if (totalWidth <= 0) return { min: 0.2, max: 0.8 };
  const min = Math.min(0.8, Math.max(0.2, MIN_CHAT_WIDTH / totalWidth));
  const max = Math.max(
    min,
    Math.min(0.8, (totalWidth - HANDLE_WIDTH - MIN_CREW_WIDTH) / totalWidth),
  );
  return { min, max };
}

export function clampShare(share: number, totalWidth = 0): number {
  const { min, max } = shareLimits(totalWidth);
  return Math.min(max, Math.max(min, share));
}

/** Null leaves unrelated keys alone. Home/End choose the useful limits, not hidden panes. */
export function keyboardShare(
  key: string,
  share: number,
  totalWidth: number,
  shift = false,
): number | null {
  if (totalWidth <= 0) return null;
  const { min, max } = shareLimits(totalWidth);
  if (key === "Home") return min;
  if (key === "End") return max;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const step = (shift ? 48 : 16) / totalWidth;
  return clampShare(share + (key === "ArrowLeft" ? -step : step), totalWidth);
}
