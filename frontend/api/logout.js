import handleRequest from './_lib/server.js';

export default async function handler(req, res) {
  if (!req.url || req.url === '/' || !req.url.startsWith('/api')) {
    req.url = '/api/logout';
  }
  return handleRequest(req, res);
}
