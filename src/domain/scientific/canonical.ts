import { createHash } from "node:crypto";
import { types } from "node:util";

const MAX_DEPTH = 64;

function assertUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new TypeError("Canonical JSON cannot contain lone surrogates");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("Canonical JSON cannot contain lone surrogates");
    }
  }
}

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
    throw new TypeError("Canonical JSON requires enumerable data properties");
  return descriptor.value;
}

function serialize(value: unknown, depth: number, ancestors: WeakSet<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON requires finite numbers");
    // ECMAScript supplies RFC 8785 number formatting, including -0 -> 0.
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError("Canonical JSON contains a non-JSON value");
  // Proxy traps could mutate values during inspection or execute arbitrary getters.
  if (types.isProxy(value)) throw new TypeError("Canonical JSON cannot contain proxies");
  if (ancestors.has(value)) throw new TypeError("Canonical JSON cannot contain cycles");
  if (depth >= MAX_DEPTH) throw new TypeError("Canonical JSON exceeds maximum depth 64");

  ancestors.add(value);
  try {
    const prototype = Reflect.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string"))
      throw new TypeError("Canonical JSON cannot contain symbol properties");

    if (Array.isArray(value)) {
      if (prototype !== Array.prototype)
        throw new TypeError("Canonical JSON requires plain arrays");
      if (keys.length !== value.length + 1 || !keys.includes("length"))
        throw new TypeError("Canonical JSON requires dense arrays without extra properties");
      const elements: string[] = [];
      for (let index = 0; index < value.length; index += 1)
        elements.push(serialize(dataProperty(value, String(index)), depth + 1, ancestors));
      return `[${elements.join(",")}]`;
    }

    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError("Canonical JSON requires plain objects");
    // Default string sort compares raw UTF-16 code units. Emit each key directly:
    // rebuilding an object would let JSON.stringify reorder integer-like keys.
    const members: string[] = [];
    for (const key of (keys as string[]).sort()) {
      assertUnicode(key);
      members.push(
        `${JSON.stringify(key)}:${serialize(dataProperty(value, key), depth + 1, ancestors)}`,
      );
    }
    return `{${members.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** RFC 8785 JSON text, without a BOM or trailing newline; at most 64 nested containers. */
export function canonicalize(value: unknown): string {
  return serialize(value, 0, new WeakSet<object>());
}

/** Hash the exact UTF-8 text supplied, without reparsing or normalizing it. */
export function hashCanonicalBytes(text: string): string {
  if (typeof text !== "string") throw new TypeError("Canonical bytes must be a string");
  assertUnicode(text);
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function canonicalHash(value: unknown): string {
  return hashCanonicalBytes(canonicalize(value));
}

/** A bounded JSON reader that detects duplicate decoded names before building objects. */
class StrictJsonReader {
  private offset = 0;
  private readonly numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

  constructor(private readonly text: string) {}

  read(): unknown {
    const value = this.value(0);
    this.whitespace();
    if (this.offset !== this.text.length) this.fail("Unexpected trailing content");
    return value;
  }

  private fail(reason: string): never {
    throw new SyntaxError(`${reason} at JSON offset ${this.offset}`);
  }

  private whitespace(): void {
    while (this.offset < this.text.length) {
      const code = this.text.charCodeAt(this.offset);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break;
      this.offset += 1;
    }
  }

  private value(depth: number): unknown {
    this.whitespace();
    const first = this.text[this.offset];
    if (first === '"') return this.string();
    if (first === "{" || first === "[") {
      if (depth >= MAX_DEPTH) this.fail("JSON exceeds maximum depth 64");
      return first === "{" ? this.object(depth + 1) : this.array(depth + 1);
    }
    for (const [token, value] of [
      ["null", null],
      ["true", true],
      ["false", false],
    ] as const) {
      if (this.text.startsWith(token, this.offset)) {
        this.offset += token.length;
        return value;
      }
    }
    this.numberPattern.lastIndex = this.offset;
    const match = this.numberPattern.exec(this.text);
    if (!match) this.fail("Expected a JSON value");
    this.offset = this.numberPattern.lastIndex;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) this.fail("JSON numbers must be finite");
    return number;
  }

  private string(): string {
    const start = this.offset;
    this.offset += 1;
    while (this.offset < this.text.length) {
      const character = this.text[this.offset];
      if (character === '"') {
        this.offset += 1;
        // Parsing only this string token is safe: object names are checked below.
        let value: string;
        try {
          value = JSON.parse(this.text.slice(start, this.offset)) as string;
          assertUnicode(value);
        } catch {
          this.fail("Invalid JSON string or lone surrogate");
        }
        return value;
      }
      if (this.text.charCodeAt(this.offset) < 0x20) this.fail("Unescaped control in JSON string");
      this.offset += character === "\\" ? 2 : 1;
    }
    this.fail("Unterminated JSON string");
  }

  private object(depth: number): Record<string, unknown> {
    this.offset += 1;
    this.whitespace();
    const object: Record<string, unknown> = {};
    const names = new Set<string>();
    if (this.text[this.offset] === "}") {
      this.offset += 1;
      return object;
    }
    while (true) {
      if (this.text[this.offset] !== '"') this.fail("Expected an object property name");
      const name = this.string();
      if (names.has(name)) this.fail("Duplicate JSON object property");
      names.add(name);
      this.whitespace();
      if (this.text[this.offset] !== ":") this.fail("Expected colon after object property name");
      this.offset += 1;
      // Define rather than assign so __proto__ remains an ordinary own property.
      Object.defineProperty(object, name, {
        value: this.value(depth),
        enumerable: true,
        configurable: true,
        writable: true,
      });
      this.whitespace();
      const separator = this.text[this.offset];
      this.offset += 1;
      if (separator === "}") return object;
      if (separator !== ",") this.fail("Expected comma or closing object brace");
      this.whitespace();
    }
  }

  private array(depth: number): unknown[] {
    this.offset += 1;
    this.whitespace();
    const array: unknown[] = [];
    if (this.text[this.offset] === "]") {
      this.offset += 1;
      return array;
    }
    while (true) {
      array.push(this.value(depth));
      this.whitespace();
      const separator = this.text[this.offset];
      this.offset += 1;
      if (separator === "]") return array;
      if (separator !== ",") this.fail("Expected comma or closing array bracket");
    }
  }
}

/** Strict JSON syntax plus JCS Unicode/finite-number requirements; preserves parsed -0. */
export function parseStrictJson(text: string): unknown {
  if (typeof text !== "string") throw new TypeError("JSON input must be a string");
  return new StrictJsonReader(text).read();
}
