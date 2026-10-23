/** WCAG relative luminance and contrast for the host's opaque hex palette tokens. */
function luminance(color: string): number {
  const hex = color.slice(1);
  const rgb = hex.length === 3 ? [...hex].map(c => c + c).join("") : hex;
  const channels = [0, 2, 4].map(i => {
    const value = parseInt(rgb.slice(i, i + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

export function contrastRatio(first: string, second: string): number {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
