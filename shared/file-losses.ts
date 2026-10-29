/** Plain descriptions of task removals and completed work made unfinished by a replacement. */
export function fileLosses(before: string, after: string): string[] {
  function tasks(text: string) {
    let section = "";
    return text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/).flatMap(line => {
      const heading = /^#{1,6}\s+(.*)/.exec(line);
      if (heading) section = heading[1] ?? "";
      const task = /^\s*[-*+]\s+\[([ xX~-])\]\s+(.+)/.exec(line);
      if (!task) return [];
      const text = task[2]!;
      const id = /^([\w.-]+)\s+[-–—]\s+/.exec(text)?.[1];
      return [{ key: id ?? text, text, done: /^[xX]$/.test(task[1]!) || /^(done|landed|finished)\b/i.test(section),
        active: /^(in[\s-]*flight|queued|queue|next|charted)\b/i.test(section) }];
    });
  }
  const remaining = tasks(after);
  return tasks(before).flatMap(task => {
    const index = remaining.findIndex(next => next.key === task.key);
    if (index < 0) return [`Remove task: ${task.text}`];
    const [next] = remaining.splice(index, 1);
    return task.done && (!next!.done || (next!.active && !task.active)) ? [`Mark unfinished again: ${task.text}`] : [];
  });
}
