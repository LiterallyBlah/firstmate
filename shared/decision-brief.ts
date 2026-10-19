/** Small, lossless section reader for authored decision briefs, not a Markdown replacement. */
export interface BriefSection {
  title: string;
  body: string;
  kind: "background" | "options" | "recommendation" | "other";
}
export interface BriefOption {
  number: string;
  label: string;
  body: string;
}
export function parseDecisionBrief(markdown: string) {
  const sections: BriefSection[] = [];
  let section: BriefSection = { title: "", body: "", kind: "other" };
  let fence = false;
  const push = () => {
    section.body = section.body.trim();
    if (section.title || section.body) sections.push(section);
  };
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const heading =
      !fence &&
      (/^#{1,2}\s+(.+?)\s*#*\s*$/.exec(line) ??
        /^\*\*((?:Background|Context|Options(?: and trade-offs)?|(?:My |Our )?Recommendation)[.:]?)\*\*\s*(.*)$/i.exec(
          line,
        ));
    if (heading) {
      push();
      const title = heading[1]!.replace(/[.:]$/, "");
      const kind = /recommendation/i.test(title)
        ? "recommendation"
        : /^(background|context)$/i.test(title)
          ? "background"
          : /^options\b/i.test(title)
            ? "options"
            : "other";
      section = { title, kind, body: heading[2] ?? "" };
    } else section.body += `${section.body ? "\n" : ""}${line}`;
  }
  push();
  const options: BriefOption[] = [];
  for (const part of sections.filter((s) => s.kind === "options")) {
    // Code examples are reading material, never choices inferred from their numbered lines.
    if (/^\s*(```|~~~)/m.test(part.body)) continue;
    const rows = [
      ...part.body.matchAll(/^(\d+)[.)]\s+\*\*(.+?)\*\*([^\n]*)/gm),
    ];
    for (const [i, row] of rows.entries()) {
      const body = part.body
        .slice(row.index, rows[i + 1]?.index ?? part.body.length)
        .trim();
      const label = row[2]!
        .replace(/\s*\(recommended\)/gi, "")
        .replace(/[.:]$/, "")
        .trim();
      if (
        label &&
        !options.some(
          (option) => option.number === row[1] || option.label === label,
        )
      )
        options.push({ number: row[1]!, label, body });
      else
        return {
          sections,
          options: [],
          recommendation: recommendation(sections),
        };
    }
  }
  return { sections, options, recommendation: recommendation(sections) };
}
function recommendation(sections: BriefSection[]) {
  return sections
    .filter((s) => s.kind === "recommendation")
    .map((s) => s.body)
    .join("\n\n");
}
