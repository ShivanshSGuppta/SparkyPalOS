import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { randomUUID } from 'crypto';
import { generateChat, streamChat } from './llmAdapter.js';
import {
  getCalendarEvents,
  getEpicChapters,
  getEpicReadContent,
  getAnimeReadContent,
  getAnimeBooks,
  getArxivReadContent,
  getCartoons,
  getGitaChapters,
  getGitaVerses,
  getLiveNews,
  getNewsReadContent,
  getSportsSuredbits,
  getStockChart,
  getStockQuote,
  getStockWatchlist,
  getMusicCatalog,
  mapReverse,
  mapSearch,
  getProviderBundle,
  getProviderDiagnostics,
  searchArxiv,
  getTopUsSongs,
  searchCatalog
} from './publicApiAdapters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function normalizeLimit(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function normalizeSymbolList(input = '') {
  return input
    .toString()
    .split(',')
    .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, ''))
    .filter(Boolean)
    .slice(0, 25);
}

function validateMathExpression(expression) {
  const expr = typeof expression === 'string' ? expression.trim() : '';
  if (!expr) return 'expression is required';
  if (expr.length > 200) return 'expression too long';
  if (!/^[0-9+\-*/%^().,\sA-Za-z_]+$/.test(expr)) return 'expression contains unsupported characters';
  if (/__|=>|;|{|}|\[|\]|\\/.test(expr)) return 'expression contains blocked syntax';
  return null;
}

function solveMathExpression(expression, mode = 'evaluate') {
  const normalized = expression.replace(/\^/g, '**').trim();
  const allowedFns = {
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    sqrt: Math.sqrt,
    abs: Math.abs,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    log: Math.log10,
    ln: Math.log,
    exp: Math.exp,
    pow: Math.pow,
    min: Math.min,
    max: Math.max,
    pi: Math.PI,
    e: Math.E
  };

  const identifiers = normalized.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  for (const token of identifiers) {
    if (!Object.prototype.hasOwnProperty.call(allowedFns, token.toLowerCase())) {
      throw new Error(`unsupported token: ${token}`);
    }
  }

  const args = Object.keys(allowedFns);
  const values = args.map((k) => allowedFns[k]);
  // NOTE: token validation above constrains what can be evaluated.
  const fn = new Function(...args, `"use strict"; return (${normalized});`);
  const result = Number(fn(...values));
  if (!Number.isFinite(result)) {
    throw new Error('expression did not produce a finite number');
  }
  const simplified = normalized
    .replace(/\s+/g, '')
    .replace(/\+\+/g, '+')
    .replace(/--/g, '+')
    .replace(/\+-/g, '-');
  const steps = [
    `Input: ${expression}`,
    `Normalized: ${normalized}`,
    `Simplified: ${simplified}`,
    `Mode: ${mode || 'evaluate'}`
  ];
  return { result, simplified, steps };
}

function blockUnsafeCode(language, code) {
  const input = code.toString();
  const jsBanned = [
    /\bimport\b/i, /\brequire\b/i, /\bprocess\b/i, /\bglobal\b/i, /\bfetch\b/i, /\bXMLHttpRequest\b/i,
    /\bWebSocket\b/i, /\bFunction\b/i, /\beval\b/i, /\bchild_process\b/i, /\bfs\b/i, /\bhttp\b/i, /\bhttps\b/i,
    /\bdns\b/i, /\bnet\b/i, /\bdgram\b/i, /\bworker_threads\b/i
  ];
  const pyBanned = [
    /\bimport\b/i, /\bopen\s*\(/i, /\bexec\s*\(/i, /\beval\s*\(/i, /\b__\w+__/i, /\bos\./i, /\bsys\./i,
    /\bsubprocess\b/i, /\bsocket\b/i, /\brequests\b/i, /\burllib\b/i, /\bhttp\b/i, /\bpathlib\b/i
  ];
  const patterns = language === 'python' ? pyBanned : jsBanned;
  for (const pattern of patterns) {
    if (pattern.test(input)) {
      return `blocked code pattern: ${pattern.toString()}`;
    }
  }
  return '';
}

async function runSandboxedCompiler({ language, code, stdin = '' }) {
  const lang = language === 'python' ? 'python' : 'javascript';
  const source = typeof code === 'string' ? code : '';
  if (!source.trim()) {
    return { ok: false, error: 'code is required' };
  }
  if (source.length > 12000) {
    return { ok: false, error: 'code too long (max 12000 chars)' };
  }
  const blocked = blockUnsafeCode(lang, source);
  if (blocked) return { ok: false, error: blocked };

  const outputLimit = 12000;
  const timeoutMs = 3000;
  const env = {
    SPK_CODE_B64: Buffer.from(source, 'utf8').toString('base64'),
    SPK_STDIN_B64: Buffer.from((stdin || '').toString(), 'utf8').toString('base64'),
    SPK_OUTPUT_LIMIT: String(outputLimit)
  };

  const runtime = lang === 'python'
    ? {
      cmd: 'python3',
      args: ['-I', '-c', `
import base64, math
code = base64.b64decode(__import__('os').environ.get('SPK_CODE_B64', '')).decode('utf-8', errors='ignore')
stdin_data = base64.b64decode(__import__('os').environ.get('SPK_STDIN_B64', '')).decode('utf-8', errors='ignore')
limit = int(__import__('os').environ.get('SPK_OUTPUT_LIMIT', '12000'))
buf = []
size = 0
def _emit(*args):
    global size
    line = ' '.join(str(a) for a in args) + '\\n'
    size += len(line)
    if size <= limit:
        buf.append(line)
safe_builtins = {
    'abs': abs, 'min': min, 'max': max, 'sum': sum, 'len': len, 'range': range,
    'print': _emit, 'round': round, 'int': int, 'float': float, 'str': str
}
ctx = {'__builtins__': safe_builtins, 'math': math, 'stdin': stdin_data}
try:
    exec(code, ctx, ctx)
    if '_result' in ctx:
        _emit(ctx['_result'])
except Exception as exc:
    _emit(f'Error: {exc}')
print(''.join(buf), end='')
`]
    }
    : {
      cmd: 'node',
      args: ['-e', `
const vm = require('vm');
const code = Buffer.from(process.env.SPK_CODE_B64 || '', 'base64').toString('utf8');
const stdin = Buffer.from(process.env.SPK_STDIN_B64 || '', 'base64').toString('utf8');
const limit = Number(process.env.SPK_OUTPUT_LIMIT || 12000);
let out = '';
const emit = (...args) => {
  const line = args.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\\n';
  if (out.length + line.length <= limit) out += line;
};
const sandbox = {
  console: { log: emit, warn: emit, error: emit },
  Math, Number, String, Boolean, Array, Object, JSON, Date,
  stdin
};
sandbox.globalThis = sandbox;
try {
  vm.createContext(sandbox);
  const result = vm.runInContext(code, sandbox, { timeout: 2000 });
  if (typeof result !== 'undefined') emit(result);
} catch (err) {
  emit('Error:', err && err.message ? err.message : String(err));
}
process.stdout.write(out);
`]
    };

  return await new Promise((resolve) => {
    const child = spawn(runtime.cmd, runtime.args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > outputLimit) stdout = stdout.slice(0, outputLimit);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 2000) stderr = stderr.slice(0, 2000);
    });
    child.on('close', (codeNum) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ ok: false, error: 'execution timed out', stdout, stderr: '' });
        return;
      }
      resolve({
        ok: codeNum === 0 || Boolean(stdout),
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        exitCode: codeNum
      });
    });
  });
}

export function createApp() {
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';
  const trustedProxy = process.env.TRUST_PROXY;
  const requestSizeLimit = process.env.REQUEST_SIZE_LIMIT || '512kb';
  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  app.disable('x-powered-by');
  if (trustedProxy !== undefined) {
    const numeric = Number(trustedProxy);
    app.set('trust proxy', Number.isFinite(numeric) ? numeric : trustedProxy);
  } else if (isProduction) {
    app.set('trust proxy', 1);
  }

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
    if (isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (!corsOrigins.length && !isProduction) return callback(null, true);
      if (!corsOrigins.length && isProduction) return callback(new Error('CORS origin rejected'));
      if (corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS origin rejected'));
    },
    credentials: false
  }));
  app.use(express.json({ limit: requestSizeLimit }));

  const sessions = new Map();
  const ipBucket = new Map();
  const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
  const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 90);

  function now() {
    return Date.now();
  }

  function cleanupRateBucket(ip) {
    const ts = now();
    const arr = ipBucket.get(ip) || [];
    const next = arr.filter((t) => ts - t < rateLimitWindowMs);
    ipBucket.set(ip, next);
    return next;
  }

  function rateLimit(req, res, next) {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || 'local';
    const entries = cleanupRateBucket(ip);
    if (entries.length >= rateLimitMax) {
      return res.status(429).json({ error: 'rate_limited', message: 'Too many requests, retry later.' });
    }
    entries.push(now());
    ipBucket.set(ip, entries);
    return next();
  }

  function requireAuth(req, res, next) {
    const requiredToken = process.env.AUTH_TOKEN;
    if (!requiredToken) return next();

    const auth = req.headers.authorization || '';
    const incoming = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (incoming !== requiredToken) {
      return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid token.' });
    }
    return next();
  }

  function validateMessage(input) {
    if (typeof input !== 'string') return 'message must be a string';
    const msg = input.trim();
    if (!msg) return 'message is required';
    if (msg.length > 4000) return 'message too long (max 4000 chars)';
    return null;
  }

  function getOrCreateSession(sessionId, username = 'USER') {
    const id = sessionId || randomUUID();
    if (!sessions.has(id)) {
      sessions.set(id, {
        id,
        username,
        createdAt: new Date().toISOString(),
        history: []
      });
    }
    return sessions.get(id);
  }

  function appendHistory(session, role, content) {
    session.history.push({ role, content, ts: new Date().toISOString() });
    if (session.history.length > 30) {
      session.history = session.history.slice(-30);
    }
  }

  async function weatherTool(args) {
    const lat = Number(args?.latitude);
    const lon = Number(args?.longitude);
    const useDefault = Number.isNaN(lat) || Number.isNaN(lon);
    const latitude = useDefault ? 40.7128 : lat;
    const longitude = useDefault ? -74.006 : lon;

    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`
    );
    if (!res.ok) {
      throw new Error(`weather fetch failed (${res.status})`);
    }
    const data = await res.json();
    return {
      latitude,
      longitude,
      current_weather: data.current_weather || null
    };
  }

  const toolPolicies = {
    weather: { enabled: true },
    time: { enabled: true },
    echo: { enabled: true },
    listFiles: { enabled: true }
  };

  const toolHandlers = {
    weather: async (args) => weatherTool(args),
    time: async () => ({ now: new Date().toISOString() }),
    echo: async (args) => ({ echoed: args?.text || '' }),
    listFiles: async () => {
      const fs = await import('fs/promises');
      const entries = await fs.readdir(rootDir, { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
    }
  };

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'sparky-backend',
      time: new Date().toISOString(),
      sessions: sessions.size,
      llmConfigured: Boolean(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY)
    });
  });

  app.get('/api/providers', (_req, res) => {
    res.json({ ok: true, ...getProviderBundle() });
  });

  app.get('/api/providers/diagnostics', (_req, res) => {
    res.json({ ok: true, diagnostics: getProviderDiagnostics(), time: new Date().toISOString() });
  });

  app.get('/api/calendar/events', rateLimit, async (req, res) => {
    try {
      const from = req.query.from?.toString() || '';
      const to = req.query.to?.toString() || '';
      const items = await getCalendarEvents(from, to);
      return res.json({ ok: true, from, to, count: items.length, results: items });
    } catch (error) {
      return res.status(500).json({ error: 'calendar_failed', message: error.message });
    }
  });

  app.get('/api/sports/suredbits', rateLimit, async (req, res) => {
    try {
      const sport = req.query.sport?.toString() || 'basketball';
      const league = req.query.league?.toString() || 'nba';
      const date = req.query.date?.toString() || '';
      const fallback = req.query.fallback?.toString() !== '0';
      const result = await getSportsSuredbits({ sport, league, date, fallback });
      return res.json({
        ok: true,
        sport,
        league,
        date,
        fallback,
        count: result.items.length,
        content: { reason: result.reason || '', activeFilter: result.activeFilter || null },
        results: result.items
      });
    } catch (error) {
      return res.status(500).json({ error: 'sports_failed', message: error.message });
    }
  });

  app.get('/api/research/arxiv', rateLimit, async (req, res) => {
    try {
      const q = req.query.q?.toString() || '';
      const start = normalizeLimit(req.query.start, 0, 0, 500);
      const limit = normalizeLimit(req.query.limit, 20, 1, 25);
      if (!q.trim()) {
        return res.status(400).json({ error: 'invalid_request', message: 'q is required' });
      }
      const items = await searchArxiv(q, start, limit);
      return res.json({ ok: true, query: q, start, limit, count: items.length, results: items });
    } catch (error) {
      return res.status(500).json({ error: 'arxiv_failed', message: error.message });
    }
  });

  app.get('/api/research/arxiv/read', rateLimit, async (req, res) => {
    try {
      const id = req.query.id?.toString() || '';
      const title = req.query.title?.toString() || '';
      const url = req.query.url?.toString() || '';
      const description = req.query.description?.toString() || '';
      if (!id && !title && !url && !description) {
        return res.status(400).json({ error: 'invalid_request', message: 'id, title, or url is required' });
      }
      const result = await getArxivReadContent({ id, title, url, description });
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(500).json({ error: 'arxiv_read_failed', message: error.message });
    }
  });

  app.get('/api/map/search', rateLimit, async (req, res) => {
    try {
      const q = req.query.q?.toString() || '';
      const limit = normalizeLimit(req.query.limit, 10, 1, 20);
      if (!q.trim()) {
        return res.status(400).json({ error: 'invalid_request', message: 'q is required' });
      }
      const items = await mapSearch(q, limit);
      return res.json({ ok: true, query: q, count: items.length, results: items });
    } catch (error) {
      return res.status(500).json({ error: 'map_search_failed', message: error.message });
    }
  });

  app.get('/api/map/reverse', rateLimit, async (req, res) => {
    try {
      const lat = req.query.lat?.toString() || '';
      const lon = req.query.lon?.toString() || '';
      const item = await mapReverse(lat, lon);
      if (!item) {
        return res.status(400).json({ error: 'invalid_request', message: 'valid lat and lon are required' });
      }
      return res.json({ ok: true, result: item });
    } catch (error) {
      return res.status(500).json({ error: 'map_reverse_failed', message: error.message });
    }
  });

  app.post('/api/math/solve', rateLimit, async (req, res) => {
    try {
      const expression = req.body?.expression;
      const mode = req.body?.mode?.toString() || 'evaluate';
      const invalid = validateMathExpression(expression);
      if (invalid) {
        return res.status(400).json({ error: 'invalid_request', message: invalid });
      }
      const solved = solveMathExpression(expression, mode);
      return res.json({ ok: true, expression, ...solved });
    } catch (error) {
      return res.status(400).json({ error: 'math_failed', message: error.message });
    }
  });

  app.post('/api/compiler/run', rateLimit, async (req, res) => {
    try {
      const rawLanguage = req.body?.language?.toString() || '';
      const language = rawLanguage === 'python' ? 'python' : rawLanguage === 'javascript' ? 'javascript' : '';
      const code = req.body?.code?.toString() || '';
      const stdin = req.body?.stdin?.toString() || '';
      if (!['javascript', 'python'].includes(language)) {
        return res.status(400).json({ error: 'invalid_request', message: 'language must be javascript or python' });
      }
      const result = await runSandboxedCompiler({ language, code, stdin });
      if (!result.ok) {
        return res.status(400).json({ error: 'compiler_failed', ...result });
      }
      return res.json({ ok: true, language, ...result });
    } catch (error) {
      return res.status(500).json({ error: 'compiler_failed', message: error.message });
    }
  });

  app.get('/api/news/live', rateLimit, async (req, res) => {
    try {
      const category = req.query.category?.toString() || 'top';
      const region = req.query.region?.toString() || 'US';
      const limit = normalizeLimit(req.query.limit, 20, 5, 40);
      const items = await getLiveNews({ category, region, limit });
      return res.json({ ok: true, category, region, count: items.length, results: items });
    } catch (error) {
      return res.status(500).json({ error: 'news_failed', message: error.message });
    }
  });

  app.get('/api/news/read', rateLimit, async (req, res) => {
    try {
      const id = req.query.id?.toString() || '';
      const title = req.query.title?.toString() || '';
      const url = req.query.url?.toString() || '';
      const description = req.query.description?.toString() || '';
      if (!id && !title && !url) {
        return res.status(400).json({ error: 'invalid_request', message: 'id, title, or url is required' });
      }
      const result = await getNewsReadContent({ id, title, url, description });
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(500).json({ error: 'news_read_failed', message: error.message });
    }
  });

  app.get('/api/epics/mahabharat/chapters', rateLimit, async (req, res) => {
    try {
      const lang = req.query.lang?.toString() || 'eng';
      const results = getEpicChapters('mahabharat', lang);
      return res.json({ ok: true, epic: 'mahabharat', lang, count: results.length, results });
    } catch (error) {
      return res.status(500).json({ error: 'epic_chapters_failed', message: error.message });
    }
  });

  app.get('/api/epics/mahabharat/read', rateLimit, async (req, res) => {
    try {
      const chapterId = req.query.chapterId?.toString() || '1';
      const lang = req.query.lang?.toString() || 'eng';
      const result = await getEpicReadContent('mahabharat', chapterId, lang);
      return res.json({ ok: true, epic: 'mahabharat', chapterId, lang, result });
    } catch (error) {
      return res.status(500).json({ error: 'epic_read_failed', message: error.message });
    }
  });

  app.get('/api/epics/ramayan/chapters', rateLimit, async (req, res) => {
    try {
      const lang = req.query.lang?.toString() || 'eng';
      const results = getEpicChapters('ramayan', lang);
      return res.json({ ok: true, epic: 'ramayan', lang, count: results.length, results });
    } catch (error) {
      return res.status(500).json({ error: 'epic_chapters_failed', message: error.message });
    }
  });

  app.get('/api/epics/ramayan/read', rateLimit, async (req, res) => {
    try {
      const chapterId = req.query.chapterId?.toString() || '1';
      const lang = req.query.lang?.toString() || 'eng';
      const result = await getEpicReadContent('ramayan', chapterId, lang);
      return res.json({ ok: true, epic: 'ramayan', chapterId, lang, result });
    } catch (error) {
      return res.status(500).json({ error: 'epic_read_failed', message: error.message });
    }
  });

  app.get('/api/stocks/quote', rateLimit, async (req, res) => {
    try {
      const symbol = req.query.symbol?.toString() || 'AAPL';
      const item = await getStockQuote(symbol);
      if (!item) return res.status(404).json({ error: 'not_found', message: 'symbol not found' });
      return res.json({ ok: true, symbol, result: item });
    } catch (error) {
      return res.status(500).json({ error: 'stocks_quote_failed', message: error.message });
    }
  });

  app.get('/api/stocks/watchlist', rateLimit, async (req, res) => {
    try {
      const symbols = normalizeSymbolList(req.query.symbols?.toString() || '');
      const items = await getStockWatchlist(symbols);
      return res.json({ ok: true, symbols: symbols.length ? symbols : ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NVDA'], count: items.length, results: items });
    } catch (error) {
      return res.status(500).json({ error: 'stocks_watchlist_failed', message: error.message });
    }
  });

  app.get('/api/stocks/chart', rateLimit, async (req, res) => {
    try {
      const symbol = req.query.symbol?.toString() || 'AAPL';
      const range = req.query.range?.toString() || '1d';
      const result = await getStockChart(symbol, range);
      return res.json({ ok: true, result });
    } catch (error) {
      return res.status(500).json({ error: 'stocks_chart_failed', message: error.message });
    }
  });

  app.get('/api/search', rateLimit, async (req, res) => {
    try {
      const q = req.query.q?.toString() || '';
      const source = req.query.source?.toString() || 'all';
      if (!q.trim()) {
        return res.status(400).json({ error: 'invalid_request', message: 'q is required' });
      }
      const results = await searchCatalog(q, source);
      return res.json({ ok: true, query: q, source, count: results.length, results });
    } catch (error) {
      return res.status(500).json({ error: 'search_failed', message: error.message });
    }
  });

  app.get('/api/music/top-us', rateLimit, async (req, res) => {
    try {
      const limit = normalizeLimit(req.query.limit, 100, 20, 100);
      const items = await getTopUsSongs(limit);
      return res.json({ ok: true, count: items.length, results: items });
    } catch (error) {
      return res.status(500).json({ error: 'music_failed', message: error.message });
    }
  });

  app.get('/api/music/catalog', rateLimit, async (req, res) => {
    try {
      const limit = normalizeLimit(req.query.limit, 100, 20, 140);
      const langs = req.query.langs?.toString() || 'en,hi,pa';
      const mode = req.query.mode?.toString() || 'hybrid';
      const items = await getMusicCatalog({ limit, langs, mode });
      return res.json({ ok: true, limit, langs, mode, count: items.length, results: items });
    } catch (error) {
      return res.status(500).json({ error: 'music_catalog_failed', message: error.message });
    }
  });

  app.get('/api/video/cartoons', rateLimit, async (req, res) => {
    try {
      const limit = normalizeLimit(req.query.limit, 15, 10, 30);
      const topic = req.query.topic?.toString() || 'space-robotics';
      const items = await getCartoons(limit, topic);
      return res.json({ ok: true, topic, count: items.length, results: items });
    } catch (error) {
      return res.status(500).json({ error: 'video_failed', message: error.message });
    }
  });

  app.get('/api/gita/chapters', rateLimit, async (_req, res) => {
    try {
      const items = await getGitaChapters();
      return res.json({ ok: true, count: items.length, results: items });
    } catch (error) {
      return res.status(500).json({ error: 'gita_chapters_failed', message: error.message });
    }
  });

  app.get('/api/gita/chapters/:id/verses', rateLimit, async (req, res) => {
    try {
      const language = req.query.lang?.toString() || 'eng';
      const items = await getGitaVerses(req.params.id, language);
      return res.json({ ok: true, chapterId: req.params.id, language, count: items.length, results: items });
    } catch (error) {
      return res.status(500).json({ error: 'gita_verses_failed', message: error.message });
    }
  });

  app.get('/api/anime/books', rateLimit, async (req, res) => {
    try {
      const query = req.query.query?.toString() || 'one piece';
      const limit = normalizeLimit(req.query.limit, 18, 6, 25);
      const items = await getAnimeBooks(query, limit);
      return res.json({ ok: true, query, count: items.length, results: items });
    } catch (error) {
      return res.status(500).json({ error: 'anime_failed', message: error.message });
    }
  });

  app.get('/api/anime/read', rateLimit, async (req, res) => {
    try {
      const id = req.query.id?.toString() || '';
      const title = req.query.title?.toString() || '';
      const textUrl = req.query.textUrl?.toString() || '';
      if (!id && !title && !textUrl) {
        return res.status(400).json({ error: 'invalid_request', message: 'id, title, or textUrl is required' });
      }
      const item = await getAnimeReadContent({ id, title, textUrl });
      return res.json({ ok: true, result: item });
    } catch (error) {
      return res.status(500).json({ error: 'anime_read_failed', message: error.message });
    }
  });

  app.post('/api/session', rateLimit, requireAuth, (req, res) => {
    const { sessionId, username } = req.body || {};
    const session = getOrCreateSession(sessionId, typeof username === 'string' && username.trim() ? username.trim() : 'USER');

    return res.json({
      sessionId: session.id,
      username: session.username,
      createdAt: session.createdAt,
      historyCount: session.history.length
    });
  });

  app.post('/api/chat', rateLimit, requireAuth, async (req, res) => {
    try {
      const { sessionId, message, model } = req.body || {};
      const invalid = validateMessage(message);
      if (invalid) return res.status(400).json({ error: 'invalid_request', message: invalid });

      const session = getOrCreateSession(sessionId);
      appendHistory(session, 'user', message.trim());

      const assistant = await generateChat({ history: session.history, model });
      appendHistory(session, 'assistant', assistant);

      return res.json({
        sessionId: session.id,
        message: assistant,
        historyCount: session.history.length
      });
    } catch (error) {
      return res.status(500).json({ error: 'chat_failed', message: error.message });
    }
  });

  app.get('/api/chat/stream', rateLimit, requireAuth, async (req, res) => {
    const sessionId = req.query.sessionId?.toString() || '';
    const message = req.query.message?.toString() || '';
    const model = req.query.model?.toString() || undefined;
    const invalid = validateMessage(message);

    if (invalid) {
      return res.status(400).json({ error: 'invalid_request', message: invalid });
    }

    const session = getOrCreateSession(sessionId);
    appendHistory(session, 'user', message.trim());

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let full = '';
    const safeWrite = (event, payload) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      safeWrite('session', { sessionId: session.id });
      full = await streamChat({
        history: session.history,
        model,
        onToken: (token) => safeWrite('token', { token })
      });
      appendHistory(session, 'assistant', full);
      safeWrite('done', { message: full, historyCount: session.history.length });
      res.end();
    } catch (error) {
      safeWrite('error', { message: error.message || 'stream_failed' });
      res.end();
    }
  });

  app.post('/api/tools/:toolName', rateLimit, requireAuth, async (req, res) => {
    const toolName = req.params.toolName;
    const policy = toolPolicies[toolName];
    const handler = toolHandlers[toolName];

    if (!policy?.enabled || !handler) {
      return res.status(404).json({ error: 'unknown_tool', message: `Tool ${toolName} is not available.` });
    }

    try {
      const result = await handler(req.body || {});
      return res.json({ ok: true, tool: toolName, result });
    } catch (error) {
      return res.status(500).json({ error: 'tool_failed', message: error.message });
    }
  });

  app.use(express.static(rootDir));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(rootDir, 'SparkyPalOS2.html'));
  });

  return app;
}

export function startServer() {
  if (process.env.NODE_ENV === 'production') {
    const required = ['CORS_ORIGINS'];
    const missing = required.filter((key) => !process.env[key] || !process.env[key].trim());
    if (missing.length) {
      throw new Error(`Missing required production env vars: ${missing.join(', ')}`);
    }
  }
  const app = createApp();
  const port = Number(process.env.PORT || 8787);
  return app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`SparkyPal backend running at http://localhost:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
