import handleRequest from './server.js';

export default async function handler(req, res) {
  const matchedPath = req.headers['x-matched-path'] || req.headers['x-forwarded-uri'] || req.headers['x-original-url'];
  if (matchedPath && matchedPath.startsWith('/api')) {
    req.url = matchedPath;
  } else if (req.query && req.query.path) {
    const segments = Array.isArray(req.query.path) ? req.query.path : [req.query.path];
    req.url = '/api/' + segments.join('/');
  }
  return handleRequest(req, res);
}
