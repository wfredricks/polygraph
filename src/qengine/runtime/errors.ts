/**
 * qengine runtime — typed errors.
 *
 * Why: Decision #19 ("Graceful fallback hides problems. Fail loud or
 * don't fail.") is the single most important rule for this engine. The
 * old regex bridge silently returned `[]` for anything it didn't
 * recognise; that habit cost us hours of debugging on 2026-05-11. Here,
 * every refusal is a typed throw so the caller (and the test runner)
 * can spot it immediately.
 *
 * @tier polygraph
 * @capability qengine.runtime
 * @style pure
 */

/**
 * Thrown when the engine cannot — or refuses to — serve a query.
 *
 * Carries the original cypher and a one-line diagnosis. The cypher is
 * truncated to 200 chars in the message so log lines stay readable;
 * the full string is preserved on `.cypher` for callers that want it.
 */
export class FailLoudError extends Error {
  readonly cypher: string;
  readonly diagnosis: string;

  constructor(cypher: string, diagnosis: string) {
    const compact = cypher.replace(/\s+/g, ' ').trim().slice(0, 200);
    super(`qengine: ${diagnosis}\n  query: ${compact}`);
    this.name = 'FailLoudError';
    this.cypher = cypher;
    this.diagnosis = diagnosis;
  }
}
