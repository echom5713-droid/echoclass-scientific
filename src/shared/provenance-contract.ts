export const MAX_PROVENANCE_IDENTITY_LENGTH = 256;
export const MACHINE_IDENTITY_PATTERN = /^[\x21-\x7e]{1,256}$/;

/** Unicode White_Space plus U+FEFF, which ECMAScript also treats as trim whitespace. */
export const UNICODE_BLANK_CODE_POINTS = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002,
  0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f,
  0x3000, 0xfeff,
] as const;

const UNICODE_BLANK_SET: ReadonlySet<number> = new Set(UNICODE_BLANK_CODE_POINTS);

export function isMachineIdentity(value: unknown): value is string {
  return typeof value === "string" && MACHINE_IDENTITY_PATTERN.test(value);
}

export function machineIdentity(value: unknown, label: string): string {
  if (!isMachineIdentity(value))
    throw new Error(`${label} must use 1-256 visible ASCII characters without spaces`);
  return value;
}

export function isUnicodeBlankText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    [...value].every((character) => UNICODE_BLANK_SET.has(character.codePointAt(0) ?? -1))
  );
}

export function hasUnicodeNonBlankText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    !value.includes("\u0000") &&
    !isUnicodeBlankText(value)
  );
}

export const hasNonBlankUnicodeText = hasUnicodeNonBlankText;

export function isBoundedPrintableIdentity(
  value: unknown,
  max = MAX_PROVENANCE_IDENTITY_LENGTH,
): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= max &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  );
}

export function boundedPrintableIdentity(value: unknown, label: string, max = 256): string {
  if (!isBoundedPrintableIdentity(value, max))
    throw new Error(`${label} must be a non-empty bounded printable identifier`);
  return value;
}
