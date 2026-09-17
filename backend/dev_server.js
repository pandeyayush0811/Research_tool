import http from 'node:http';
import worker from './worker.js';

const PORT = process.env.PORT || 8787;
const env = {
  GEMINI_PROXY_URL: process.env.GEMINI_PROXY_URL || 'http://127.0.0.1:8081/v1',
  GEMINI_PROXY_MODEL: process.env.GEMINI_PROXY_MODEL || 'gemini-3.7-flash',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'sk-gemini'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    
    let body = null;
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks).toString('utf-8');
    }

    const webReq = new Request(url.href, {
      method: req.method,
      headers: req.headers,
      body: body
    });

    const ctx = {
      waitUntil: (promise) => {
        Promise.resolve(promise).catch(e => console.error('Background task error:', e));
      }
    };

    const webRes = await worker.fetch(webReq, env, ctx);

    res.statusCode = webRes.status;
    for (const [k, v] of webRes.headers.entries()) {
      res.setHeader(k, v);
    }

    if (webRes.body) {
      const reader = webRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } else {
      res.end();
    }
  } catch (err) {
    console.error('Server error:', err);
    res.statusCode = 500;
    res.end(err.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Deep Research Backend Worker active on http://localhost:${PORT}`);
});
