import * as Sentry from '@sentry/node';

let sentryEnabled = false;

export function initMonitoring() {
  const dsn = process.env.SENTRY_DSN?.trim() || '';
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA || process.env.RELEASE || 'local',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1)
  });
  sentryEnabled = true;
}

export function withRequestContext(req, _res, next) {
  if (!sentryEnabled) return next();
  Sentry.setTag('runtime', process.env.VERCEL ? 'vercel' : 'node');
  Sentry.setContext('request', {
    method: req.method,
    path: req.path,
    requestId: req.requestId || ''
  });
  return next();
}

export function captureException(error, extra = {}) {
  if (!sentryEnabled) return;
  Sentry.captureException(error, { extra });
}

export function getSentryExpressErrorHandler() {
  if (!sentryEnabled) return null;
  if (Sentry.Handlers && typeof Sentry.Handlers.errorHandler === 'function') {
    return Sentry.Handlers.errorHandler();
  }
  return null;
}
