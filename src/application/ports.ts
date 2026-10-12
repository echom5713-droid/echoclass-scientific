import type { AIQuestion, AIResponse } from "../domain/types.js";

export interface PasswordHasher {
  hash(password: string): string;
  verify(password: string, storedHash: string): boolean;
}

export interface IdGenerator {
  random(bytes?: number): string;
  hashSession(value: string): string;
}

export interface Clock {
  now(): string;
}

export interface AIProvider {
  ask(question: AIQuestion): Promise<AIResponse>;
  status(): {
    configured: boolean;
    provider: string;
    model: string;
    base: string;
    timeoutMs: number;
  };
}

export interface RateLimiter {
  allow(key: string): boolean;
}
