import { defineMiddleware } from 'astro:middleware';

const securityHeaders: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com; frame-ancestors 'none'",
};

export const onRequest = defineMiddleware(async ({ url }, next) => {
  const response = await next();

  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value);
  }

  // Allow camera on /try
  if (url.pathname === '/try' || url.pathname === '/try/') {
    response.headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  } else {
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  }

  return response;
});
