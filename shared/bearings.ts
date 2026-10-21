/** Only plugin-owned, complete command envelopes fold; pasted examples stay visible. */
export const BEARINGS_MESSAGE_PREFIX = "firstmate-bearings-";
export function bearingsMessage(visible: string, overview: string): string {
  return `${visible}\n\n<firstmate-bearings>\n${overview.replace(/</g, "\\u003c")}\n</firstmate-bearings>`;
}
export function readBearingsMessage(text: string, messageId?: string): { visible: string; overview: string } | null {
  if (!/^firstmate-bearings-[0-9a-f-]{36}$/.test(messageId ?? "")) return null;
  const match = /^(Bearings, please[^\r\n]*)\r?\n\r?\n<firstmate-bearings>\r?\n([\s\S]+)\r?\n<\/firstmate-bearings>$/.exec(text);
  return match && !/<\/?firstmate-bearings[\s>]/.test(match[2]!) ? { visible: match[1]!, overview: match[2]! } : null;
}
