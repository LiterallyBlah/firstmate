/** Local sources are opt-in for MateChat's confined image reader. */
export function markdownImage(line: string, local = false): { uri: string; label: string; title?: string } | null {
  const match = /^!\[([^\]\n]*)\]\((?:<([^<>\n]+)>|([^()\s]+))(?:[ \t]+"([^"\n]*)")?[ \t]*\)$/.exec(line.trim());
  if (match === null) return null;
  const uri = match[2] ?? match[3] ?? "";
  if (
    !/^https?:\/\/[^\s]+$/i.test(uri) &&
    !/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/i.test(uri)
  )
    return local && !/^(?:https?:|data:)/i.test(uri)
      ? { uri, label: match[1] || "Image from the first mate", ...(match[4] === undefined ? {} : { title: match[4] }) }
      : null;
  return { uri, label: match[1] || "Image from the first mate" };
}
