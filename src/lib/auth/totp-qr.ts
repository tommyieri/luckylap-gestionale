/** The installed SDK already supplies an SVG data URI, not a raw SVG document. */
export function totpQrDataUri(value: unknown): string | null {
  const prefix = "data:image/svg+xml;utf-8,";
  if (typeof value !== "string" || !value.startsWith(prefix)) return null;
  const svg = value.slice(prefix.length).trim();
  return /^<svg(?:\s|>)/.test(svg) && svg.endsWith("</svg>") ? value : null;
}
