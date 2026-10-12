export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "PASSWORD_CHANGE_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "STORAGE_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE";

export interface ErrorField {
  field: string;
  message: string;
  code?: string;
  row_number?: number | null;
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly fields: ErrorField[] = [],
  ) {
    super(message);
    this.name = "AppError";
  }
}
