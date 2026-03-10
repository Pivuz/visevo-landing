import { defineMiddleware } from 'astro:middleware';
import { detectLocale, createT } from './i18n';

const baseHeaders: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export const onRequest = defineMiddleware(async ({ request, url, locals }, next) => {
  // Detect locale from Accept-Language header
  const acceptLanguage = request.headers.get('accept-language');
  locals.locale = detectLocale(acceptLanguage);
  locals.t = createT(locals.locale);

  const response = await next();

  for (const [key, value] of Object.entries(baseHeaders)) {
    response.headers.set(key, value);
  }

  if (url.pathname === '/scan' || url.pathname.startsWith('/scan/')) {
    response.headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    response.headers.set('Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; " +
      "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; " +
      "connect-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com; frame-ancestors 'none'"
    );
  } else {
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.headers.set('Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'"
    );
  }

  return response;
});
