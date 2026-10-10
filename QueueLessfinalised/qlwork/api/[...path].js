
import app from '../server/server.js';

export default function handler(req, res) {
  // Ensure Express receives the full API route.
  return app(req, res);
}
