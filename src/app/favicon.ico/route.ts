// Reuse the mobile app icon for browsers and crawlers requesting /favicon.ico.
export function GET() { return new Response(null, { status: 308, headers: { Location: '/icon-192.png', 'Cache-Control': 'public, max-age=86400' } }); }
