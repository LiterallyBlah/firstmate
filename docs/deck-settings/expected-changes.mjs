/** Only an explicitly reviewed pair of complete screenshots can qualify as an intentional change. */
export function expectedChange(entries, name, outcome) {
  const expected = entries[name];
  if (outcome.identical || !expected || typeof expected.reason !== 'string' || !expected.reason.trim()) return null;
  if (!Array.isArray(outcome.sha) || outcome.sha.length !== 2) return null;
  if (outcome.sha[0] !== expected.main || outcome.sha[1] !== expected.branch) return null;
  return expected.reason;
}
