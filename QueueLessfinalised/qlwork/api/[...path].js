
import app from '../server/server.js';

export default function handler(req, res) {
  const originalUrl = req.url || '/';

  // Normalize the URL so Express receives the /api prefix.
  if (
    !originalUrl.startsWith('/api/') &&
    originalUrl !== '/api'
  ) {
    req.url = `/api${originalUrl.startsWith('/') ? '' : '/'}${originalUrl}`;
  }

  return app(req, res);
}
