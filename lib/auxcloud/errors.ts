export class CloudApiError extends Error {

  constructor(
    message: string,
    readonly code?: number,
    readonly path?: string,
    readonly httpStatus?: number,
    readonly apiMessage: string = '',
  ) {
    super(message);
  }

}

export type LoginFailureReason = 'invalid_credentials' | 'locked' | 'lock_warning' | 'login_failed';

export function loginFailureReason(error: unknown): LoginFailureReason | null {
  if (!(error instanceof CloudApiError)) return null;
  if (error.code === 9021 || error.httpStatus === 429) return 'locked';
  if (error.code === 9022) return 'lock_warning';
  if (error.code === 60009) return 'invalid_credentials';
  if (/account.*lock|too many.*(attempt|login)/i.test(error.apiMessage)) return 'locked';
  if (/incorrect|invalid|wrong/i.test(error.apiMessage) && /password|account|credentials/i.test(error.apiMessage)) {
    return 'invalid_credentials';
  }
  // An explicit rejection by either login endpoint needs user attention.
  // Transport errors and server failures remain retryable.
  if (error.path?.endsWith('/login') || error.path?.endsWith('/login/pwd')) {
    if (error.httpStatus === 401) return 'invalid_credentials';
    if (error.httpStatus === 403) return 'login_failed';
    if (error.code !== undefined && (error.httpStatus ?? 200) < 500 && error.code < 500) return 'login_failed';
    if (error.code !== undefined && error.code >= 1000 && (error.httpStatus ?? 200) < 500) return 'login_failed';
  }
  return null;
}

export function isSessionExpired(error: unknown): boolean {
  if (!(error instanceof CloudApiError)) return false;
  return error.httpStatus === 401 || error.code === 401
    || /(?:token|session).*(?:expired|invalid|unauthori[sz]ed)|(?:expired|invalid).*(?:token|session)|not logged in|please (?:log|sign) in/i.test(error.apiMessage);
}
