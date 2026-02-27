import type { APIRoute } from 'astro';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      // Fallback: if D1 is not configured yet, still accept gracefully
      console.log(`[waitlist] Email captured (no D1): ${email}`);
      return new Response(
        JSON.stringify({ message: 'Thanks! You\'re on the list.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

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
