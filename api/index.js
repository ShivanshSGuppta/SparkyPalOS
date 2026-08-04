import { createApp } from '../server/index.js';

const app = createApp();

export default function handler(req, res) {
  req.requestId = req.headers['x-vercel-id'] || req.headers['x-request-id'] || '';
  return app(req, res);
}
