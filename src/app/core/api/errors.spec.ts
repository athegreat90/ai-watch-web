import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import { UnexpectedResponseError, classifyError } from './errors';

const http = (status: number, headers: Record<string, string> = {}) =>
  new HttpErrorResponse({ status, headers: new HttpHeaders(headers) });

describe('classifyError', () => {
  it('tells a refused server token from a dashboard login by the proxy header', () => {
    expect(classifyError(http(401, { 'X-AIW-Upstream-Status': '401' }))).toBe('token-rejected');
    expect(classifyError(http(401))).toBe('login-required');
  });

  it('does not treat a different upstream status as a token problem', () => {
    expect(classifyError(http(401, { 'X-AIW-Upstream-Status': '' }))).toBe('login-required');
  });

  it('maps a missing route to a proxy configuration problem', () => {
    expect(classifyError(http(404))).toBe('config');
  });

  it.each([0, 500, 502, 503, 504])('maps status %i to offline', (status) => {
    expect(classifyError(http(status))).toBe('offline');
  });

  it('maps a timeout to offline', () => {
    expect(classifyError(new TimeoutError())).toBe('offline');
  });

  it('maps an unreadable response to unexpected', () => {
    expect(classifyError(new UnexpectedResponseError())).toBe('unexpected');
  });

  it.each([400, 403, 405, 413])('maps other client error %i to unexpected', (status) => {
    expect(classifyError(http(status))).toBe('unexpected');
  });

  it('maps anything else to unexpected', () => {
    expect(classifyError(new Error('boom'))).toBe('unexpected');
  });
});
