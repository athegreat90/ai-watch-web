import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';

/**
 * What went wrong, in terms the UI can show.
 * - token-rejected: the server refused the token the proxy sends.
 * - login-required: the proxy itself wants the dashboard login (basic auth).
 * - config: a route is blocked or missing in the proxy.
 * - offline: the server cannot be reached or timed out.
 * - unexpected: the server answered with something this app does not understand.
 */
export type ApiErrorKind =
  'token-rejected' | 'login-required' | 'config' | 'offline' | 'unexpected';

export class UnexpectedResponseError extends Error {
  constructor() {
    super('Unexpected response from the server');
    this.name = 'UnexpectedResponseError';
  }
}

/** Header the Nginx proxy sets only when the AI Watch server itself answered. */
export const UPSTREAM_STATUS_HEADER = 'X-AIW-Upstream-Status';

export function classifyError(error: unknown): ApiErrorKind {
  if (error instanceof TimeoutError) return 'offline';
  if (error instanceof UnexpectedResponseError) return 'unexpected';
  if (error instanceof HttpErrorResponse) {
    const { status } = error;
    if (status === 401) {
      return error.headers.get(UPSTREAM_STATUS_HEADER) === '401'
        ? 'token-rejected'
        : 'login-required';
    }
    if (status === 404) return 'config';
    if (status === 0 || status >= 500) return 'offline';
  }
  return 'unexpected';
}
