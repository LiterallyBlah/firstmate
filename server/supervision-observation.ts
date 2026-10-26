/** Bounded read waits, never cancellation or proof of absence/death. A late read still belongs to
 * its original subject. Repeated recovery passes reuse a pending read instead of multiplying it. */
export const RECOVERY_OBSERVATION_TIMEOUT_MS = 5_000;
export class ObservationTimeout extends Error {
  constructor(readonly subject: string) { super(`Observation deadline reached for ${subject}; outcome remains unknown.`); }
}
const pending = new WeakMap<object, Map<string, Promise<unknown>>>();
export async function observeWithin<T>(receiver: object, subject: string, read: () => Promise<T>,
  timeoutMs = RECOVERY_OBSERVATION_TIMEOUT_MS): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Observation deadline must be positive and finite.");
  let reads = pending.get(receiver);
  if (!reads) { reads = new Map(); pending.set(receiver, reads); }
  let work = reads.get(subject) as Promise<T> | undefined;
  if (!work) {
    work = Promise.resolve().then(read); reads.set(subject, work);
    const captured = work, finished = () => { if (reads.get(subject) === captured) reads.delete(subject); };
    void work.then(finished, finished);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ObservationTimeout(subject)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
