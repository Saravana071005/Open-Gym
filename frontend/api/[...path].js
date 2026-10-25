import handleRequest from './server.js';

export default async function handler(req, res) {
  if (req.query && req.query.path) {
    const segments = Array.isArray(req.query.path) ? req.query.path : [req.query.path];
    const pathStr = '/api/' + segments.join('/');
    if (!req.url || !req.url.startsWith('/api')) {
      const search = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      req.url = pathStr + search;
    }
  }
  return handleRequest(req, res);
}
