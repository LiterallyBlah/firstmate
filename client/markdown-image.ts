/** Only sources the client can render itself. Workspace file references keep their existing links. */
export function markdownImage(line: string): { uri: string; label: string } | null {
  const match = /^!\[([^\]\n]*)\]\((?:<([^<>\n]+)>|([^()\s]+))(?:[ \t]+"[^"\n]*")?[ \t]*\)$/.exec(line.trim());
  if (match === null) return null;
  const uri = match[2] ?? match[3] ?? "";
  if (
    !/^https?:\/\/[^\s]+$/i.test(uri) &&
    !/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/i.test(uri)
  )
    return null;
  return { uri, label: match[1] || "Image from the first mate" };
}
