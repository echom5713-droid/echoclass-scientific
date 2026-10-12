export type JsonValue = null | boolean | string | number | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export class JsonSafeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonSafeError";
  }
}

function fail(label: string, path: string, reason: string): never {
  throw new JsonSafeError(`${label} ${path} ${reason}`);
}

function objectPath(path: string, key: string): string {
  return `${path}[${JSON.stringify(key)}]`;
}

function validateValue(value: unknown, label: string, path: string, active: WeakSet<object>): void {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(label, path, "must be a finite number");
    if (Object.is(value, -0)) fail(label, path, "must not be negative zero");
    return;
  }
  if (typeof value !== "object") fail(label, path, "contains a non-JSON value");
  if (active.has(value)) fail(label, path, "contains a cycle");

  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Reflect.getPrototypeOf(value) !== Array.prototype)
        fail(label, path, "must be a plain array");
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key === "symbol"))
        fail(label, path, "contains a symbol-keyed array property");
      const stringKeys = keys as string[];
      if (stringKeys.length !== value.length + 1 || !stringKeys.includes("length"))
        fail(label, path, "must be dense and contain no extra properties");
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        if (!Object.prototype.hasOwnProperty.call(value, key))
          fail(label, `${path}[${index}]`, "is a sparse array slot");
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
          fail(label, `${path}[${index}]`, "must be an enumerable data value");
        validateValue(descriptor.value, label, `${path}[${index}]`, active);
      }
      return;
    }

    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      fail(label, path, "must be a plain object");
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") fail(label, path, "contains a symbol-keyed property");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor))
        fail(label, objectPath(path, key), "must be a data property");
      if (!descriptor.enumerable)
        fail(label, objectPath(path, key), "must be an enumerable property");
      validateValue(descriptor.value, label, objectPath(path, key), active);
    }
  } catch (error) {
    if (error instanceof JsonSafeError) throw error;
    fail(label, path, "could not be inspected safely");
  } finally {
    active.delete(value);
  }
}

function sameJsonData(left: JsonValue, right: JsonValue): boolean {
  if (typeof left === "number" && typeof right === "number") return Object.is(left, right);
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
    return left === right;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => sameJsonData(item, right[index]!));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) && sameJsonData(left[key]!, right[key]!),
  );
}

export function assertJsonSafeObject(value: unknown, label: string): asserts value is JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new JsonSafeError(`${label} must be a plain JSON object`);
  validateValue(value, label, "$", new WeakSet<object>());
}

export function serializeJsonSafeObject(value: unknown, label: string): string {
  assertJsonSafeObject(value, label);
  try {
    const serialized = JSON.stringify(value);
    const parsed = JSON.parse(serialized) as unknown;
    assertJsonSafeObject(parsed, label);
    if (!sameJsonData(value, parsed))
      throw new JsonSafeError(`${label} changes during JSON serialization`);
    return serialized;
  } catch (error) {
    if (error instanceof JsonSafeError) throw error;
    throw new JsonSafeError(`${label} could not be serialized without loss`);
  }
}

export function parseJsonSafeObject(value: unknown, label: string): JsonObject {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new JsonSafeError(`${label} contains invalid JSON`);
    }
  }
  assertJsonSafeObject(parsed, label);
  return parsed;
}
