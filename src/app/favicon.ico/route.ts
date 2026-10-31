// Utility cadence icon, not an official Studio logo. Avoid implicit favicon 404s
// on script-free callback documents as well as the App Router pages.
export function GET() { return new Response(null, { status: 308, headers: { Location: '/icon.svg', 'Cache-Control': 'public, max-age=86400' } }); }
