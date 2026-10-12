/** Test without trimming or rewriting persisted text.
 * Python also treats U+001C–U+001F and U+0085 as whitespace; JavaScript adds FEFF.
 */
export function hasNonblankText(value: unknown): value is string {
  // eslint-disable-next-line no-control-regex -- These four separators are Python whitespace.
  return typeof value === "string" && /[^\s\u001c-\u001f\u0085]/u.test(value);
}
