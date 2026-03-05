import type { APIRoute } from 'astro';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RATE_LIMIT_WINDOW = 3600; // 1 hour in seconds
const RATE_LIMIT_MAX = 5; // max requests per IP per window

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();
    const email = body.email?.trim().toLowerCase();

    if (!email || !EMAIL_REGEX.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Please enter a valid email address.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const db = locals.runtime?.env?.DB;

    if (!db) {
      console.log('[waitlist] Email captured (no D1)');
      return new Response(
        JSON.stringify({ message: 'Thanks! You\'re on the list.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Rate limiting by IP
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW * 1000).toISOString();

    // Cleanup old entries and count recent requests
    await db.prepare('DELETE FROM rate_limit WHERE timestamp < ?').bind(cutoff).run();
    const countResult = await db.prepare(
      'SELECT COUNT(*) as count FROM rate_limit WHERE ip = ? AND timestamp >= ?'
    ).bind(ip, cutoff).first<{ count: number }>();

    if (countResult && countResult.count >= RATE_LIMIT_MAX) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(RATE_LIMIT_WINDOW) } }
      );
    }

    // Record this request
    await db.prepare('INSERT INTO rate_limit (ip, timestamp) VALUES (?, ?)').bind(ip, new Date().toISOString()).run();

    // Get country from Cloudflare headers
    const country = request.headers.get('cf-ipcountry') || 'unknown';

    try {
      await db.prepare(
        'INSERT INTO waitlist (email, ip_country, source) VALUES (?, ?, ?)'
      ).bind(email, country, 'landing-page').run();
    } catch (err: any) {
      // UNIQUE constraint violation = duplicate email
      if (err.message?.includes('UNIQUE')) {
        return new Response(
          JSON.stringify({ error: 'You\'re already on the list! We\'ll be in touch.' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw err;
    }

    return new Response(
      JSON.stringify({ message: 'Thanks! You\'re on the list.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[waitlist] Error:', err);
    return new Response(
      JSON.stringify({ error: 'Something went wrong. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
