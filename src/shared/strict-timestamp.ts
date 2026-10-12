const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
export const STRICT_TIMESTAMP_PATTERN = ISO_TIMESTAMP;
export const STRICT_OFFSET_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})([+-])(\d{2}):(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Canonical authoritative timestamp grammar: UTC, millisecond precision,
 * and a real Gregorian calendar date. Historical offsets are classified by
 * Migration 008 rather than accepted at new write boundaries.
 */
export function isStrictTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_TIMESTAMP.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1 || month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  return Number.isFinite(Date.parse(value));
}

export function isStrictOffsetTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = STRICT_OFFSET_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1 || month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  const offsetHour = Number(match[9]);
  const offsetMinute = Number(match[10]);
  if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0))
    return false;
  return Number.isFinite(Date.parse(value));
}

export function timestampMillis(value: unknown, label: string): number {
  if (!isStrictTimestamp(value)) throw new Error(`${label} must be a valid timestamp`);
  return Date.parse(value);
}

export function strictOffsetTimestampMillis(value: unknown, label: string): number {
  if (!isStrictOffsetTimestamp(value))
    throw new Error(`${label} must be a valid Gregorian offset timestamp`);
  return Date.parse(value);
}
