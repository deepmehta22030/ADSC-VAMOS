
import app from '../server/server.js';

export default function handler(req, res) {
  const url = new URL(
    req.url || '/',
    `http://${req.headers.host || 'localhost'}`
  );

  // Restore /api prefix if Vercel has removed it.
  if (!url.pathname.startsWith('/api/')) {
    req.url = `/api${url.pathname}${url.search}`;
  }

  return app(req, res);
}
