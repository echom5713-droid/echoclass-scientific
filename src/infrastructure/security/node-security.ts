import crypto from "node:crypto";
import type { IdGenerator, PasswordHasher } from "../../application/ports.js";

const HASH_PREFIX = "scrypt";

const defaultSecurity = new (class {
  random(bytes = 24) {
    return crypto.randomBytes(bytes).toString("hex");
  }
})();

export const nowIso = (): string => new Date().toISOString();
export const isPasswordHash = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith(`${HASH_PREFIX}$`);
export function hashPassword(password: string, salt = defaultSecurity.random(16)): string {
  const key = crypto.scryptSync(String(password ?? ""), salt, 64);
  return `${HASH_PREFIX}$${salt}$${key.toString("hex")}`;
}
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!isPasswordHash(storedHash)) return false;
  const [, salt, hex] = storedHash.split("$");
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = crypto.scryptSync(String(password ?? ""), salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export class NodeSecurity implements IdGenerator {
  random(bytes = 24): string {
    return crypto.randomBytes(bytes).toString("hex");
  }

  hashSession(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  hashPassword(password: string, salt = this.random(16)): string {
    return hashPassword(password, salt);
  }

  verify(password: string, storedHash: string): boolean {
    return verifyPassword(password, storedHash);
  }

  passwordHasher(): PasswordHasher {
    return {
      hash: (password) => this.hashPassword(password),
      verify: (password, stored) => this.verify(password, stored),
    };
  }
}
