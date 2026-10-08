import { HttpException, HttpStatus } from '@nestjs/common';

/** JSON API error carrying a stable machine-readable `code`. */
export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    super({ statusCode: status, error: HttpStatus[status] ?? 'Error', code, message, details }, status);
  }
}

/** RFC 6749 §5.2 style error for OAuth/OIDC protocol endpoints. */
export class OAuthError extends Error {
  constructor(
    public readonly error: string,
    public readonly description: string,
    public readonly status = 400,
    public readonly headers: Record<string, string> = {},
  ) {
    super(description);
  }
}
