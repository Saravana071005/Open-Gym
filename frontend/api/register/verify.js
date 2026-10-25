import handleRequest from '../server.js';

export default async function handler(req, res) {
  if (!req.url || req.url === '/' || !req.url.startsWith('/api')) {
    req.url = '/api/register/verify';
  }
  return handleRequest(req, res);
}
