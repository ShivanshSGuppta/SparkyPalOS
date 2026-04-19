import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

async function startMockLlmServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/chat/completions') {
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString();
      }
      const parsed = JSON.parse(body || '{}');

      if (parsed.stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });
        res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
        res.write('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Hello world' } }] }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  return { server, port: address.port };
}

function parseSseEvents(text) {
  const blocks = text.split('\n\n').filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split('\n');
    const event = lines.find((l) => l.startsWith('event:'))?.replace('event:', '').trim();
    const dataRaw = lines.find((l) => l.startsWith('data:'))?.replace('data:', '').trim() || '{}';
    let data = {};
    try {
      data = JSON.parse(dataRaw);
    } catch {
      data = {};
    }
    return { event, data };
  });
}

function applyEnv(overrides) {
  const keys = Object.keys(overrides);
  const previous = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  return () => {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  };
}

async function startBackend(createApp) {
  const app = createApp();
  const backend = app.listen(0);
  await new Promise((resolve) => backend.once('listening', resolve));
  const backendPort = backend.address().port;
  const base = `http://127.0.0.1:${backendPort}`;
  return { backend, base };
}

test('backend health, chat, stream, and static/security contracts', async () => {
  const restoreEnv = applyEnv({
    NODE_ENV: 'development',
    AUTH_TOKEN: undefined,
    CORS_ORIGINS: undefined,
    LLM_API_KEY: 'test-key'
  });

  const mockLlm = await startMockLlmServer();
  process.env.LLM_BASE_URL = `http://127.0.0.1:${mockLlm.port}`;

  const { createApp } = await import('../server/index.js');
  const { backend, base } = await startBackend(createApp);

  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const healthJson = await health.json();
    assert.equal(healthJson.ok, true);

    const providers = await fetch(`${base}/api/providers`);
    assert.equal(providers.status, 200);
    const providersJson = await providers.json();
    assert.equal(providersJson.ok, true);
    assert.ok(Array.isArray(providersJson.providers));

    const diagnostics = await fetch(`${base}/api/providers/diagnostics`);
    assert.equal(diagnostics.status, 200);
    const diagnosticsJson = await diagnostics.json();
    assert.equal(diagnosticsJson.ok, true);
    assert.ok(diagnosticsJson.diagnostics);

    const invalidSearch = await fetch(`${base}/api/search`);
    assert.equal(invalidSearch.status, 400);

    const invalidMap = await fetch(`${base}/api/map/search`);
    assert.equal(invalidMap.status, 400);

    const invalidArxiv = await fetch(`${base}/api/research/arxiv`);
    assert.equal(invalidArxiv.status, 400);

    const mathRes = await fetch(`${base}/api/math/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expression: '2*(3+4)^2', mode: 'simplify' })
    });
    assert.equal(mathRes.status, 200);
    const mathJson = await mathRes.json();
    assert.equal(mathJson.ok, true);
    assert.equal(mathJson.result, 98);

    const compilerRes = await fetch(`${base}/api/compiler/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'javascript', code: 'console.log("ok from compiler")' })
    });
    assert.equal(compilerRes.status, 200);
    const compilerJson = await compilerRes.json();
    assert.equal(compilerJson.ok, true);
    assert.match(compilerJson.stdout, /ok from compiler/i);

    const sessionRes = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'TESTER' })
    });
    assert.equal(sessionRes.status, 200);
    const sessionJson = await sessionRes.json();
    assert.ok(sessionJson.sessionId);

    const chatRes = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionJson.sessionId, message: 'hello' })
    });
    assert.equal(chatRes.status, 200);
    const chatJson = await chatRes.json();
    assert.equal(chatJson.message, 'Hello world');

    const streamRes = await fetch(`${base}/api/chat/stream?sessionId=${encodeURIComponent(sessionJson.sessionId)}&message=${encodeURIComponent('stream this')}`);
    assert.equal(streamRes.status, 200);
    const streamText = await streamRes.text();
    const events = parseSseEvents(streamText);

    const hasSessionEvent = events.some((e) => e.event === 'session' && e.data.sessionId);
    const tokenEvents = events.filter((e) => e.event === 'token');
    const doneEvent = events.find((e) => e.event === 'done');

    assert.equal(hasSessionEvent, true);
    assert.ok(tokenEvents.length >= 2);
    assert.equal(doneEvent?.data?.message, 'Hello world');

    const blockedNewsUrl = await fetch(`${base}/api/news/read?title=Probe&url=${encodeURIComponent('http://127.0.0.1:8787/api/health')}`);
    assert.equal(blockedNewsUrl.status, 400);

    const blockedAnimeUrl = await fetch(`${base}/api/anime/read?title=Probe&textUrl=${encodeURIComponent('http://localhost:8787/api/health')}`);
    assert.equal(blockedAnimeUrl.status, 400);

    const blockedArxivUrl = await fetch(`${base}/api/research/arxiv/read?title=Probe&url=${encodeURIComponent('http://10.0.0.5/internal')}`);
    assert.equal(blockedArxivUrl.status, 400);

    const leakedServerFile = await fetch(`${base}/server/index.js`);
    assert.notEqual(leakedServerFile.status, 200);

    const iconAsset = await fetch(`${base}/assets/sparkypal-logo.svg`);
    assert.equal(iconAsset.status, 200);
  } finally {
    await new Promise((resolve) => backend.close(resolve));
    await new Promise((resolve) => mockLlm.server.close(resolve));
    restoreEnv();
  }
});

test('rate limit is keyed by req.ip and resists x-forwarded-for spoofing', async () => {
  const restoreEnv = applyEnv({
    NODE_ENV: 'development',
    AUTH_TOKEN: undefined,
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX: '3'
  });

  const { createApp } = await import('../server/index.js');
  const { backend, base } = await startBackend(createApp);

  try {
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await fetch(`${base}/api/gita/chapters`, {
        headers: { 'x-forwarded-for': `203.0.113.${10 + i}` }
      });
      statuses.push(res.status);
    }

    assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
    assert.equal(statuses[3], 429);
  } finally {
    await new Promise((resolve) => backend.close(resolve));
    restoreEnv();
  }
});

test('production enforces auth on sensitive routes and requires AUTH_TOKEN at startup', async () => {
  const restoreEnv = applyEnv({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://app.example',
    AUTH_TOKEN: 'prod-secret',
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX: '90'
  });

  const { createApp, startServer } = await import('../server/index.js');
  const { backend, base } = await startBackend(createApp);

  try {
    const compilerNoAuth = await fetch(`${base}/api/compiler/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'javascript', code: 'console.log("x")' })
    });
    assert.equal(compilerNoAuth.status, 401);

    const compilerWithAuth = await fetch(`${base}/api/compiler/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer prod-secret'
      },
      body: JSON.stringify({ language: 'javascript', code: 'console.log("x")' })
    });
    assert.equal(compilerWithAuth.status, 200);

    const newsNoAuth = await fetch(`${base}/api/news/read?title=ProtectedRead`);
    assert.equal(newsNoAuth.status, 401);

    const newsWithAuth = await fetch(`${base}/api/news/read?title=ProtectedRead`, {
      headers: { Authorization: 'Bearer prod-secret' }
    });
    assert.equal(newsWithAuth.status, 200);

    await new Promise((resolve) => backend.close(resolve));

    const restoreMissingToken = applyEnv({ AUTH_TOKEN: undefined });
    assert.throws(() => startServer(), /AUTH_TOKEN/);
    restoreMissingToken();
  } finally {
    if (backend.listening) {
      await new Promise((resolve) => backend.close(resolve));
    }
    restoreEnv();
  }
});
