/**
 * Unified Cloudflare Worker: Smart Two-Tier Hybrid Architecture.
 * 1. Tier 1 (Guest Flash Router - No Cookie): 0 history pollution, fast 5-7 query generation.
 * 2. High-yield Edge Crawler: Video link filtering + dense text scraping.
 * 3. Tier 2 (Authenticated Pro Synthesis - With Cookie): Pro model reasoning with citations.
 */

import { routeIntent } from './core/router.js';
import { liveSearch } from './tools/search.js';
import { scrapePage } from './tools/scraper.js';
import { buildSynthesisPrompt } from './core/synthesizer.js';
import settings from './config/settings.json';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

let CACHED_XSRF = null;
const SESSIONS = new Map();

const MODELS = {
  'gemini-3.1-pro': { mode: 3, think: 4, desc: 'Pro model (highest reasoning & deep synthesis)' },
  'gemini-3.5-flash-thinking': { mode: 2, think: 0, desc: 'Deep thinking mode (~20k tokens output)' },
  'gemini-3.6-flash': { mode: 1, think: 4, desc: 'Fast all-around model (Gemini 3.6 Flash)' },
  'gemini-3.7-flash': { mode: 1, think: 4, desc: 'Ultra-fast flash model' },
  'gemini-flash-lite': { mode: 6, think: 4, desc: 'Lightweight high-speed model' },
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

function getRequestConfig(env) {
  return {
    geminiBl: env.GEMINI_BL || 'boq_assistant-bard-web-server_20260716.08_p0',
    cookieString: env.COOKIE_STRING || null,
    defaultModel: env.DEFAULT_MODEL || (env.COOKIE_STRING ? 'gemini-3.1-pro' : 'gemini-3.6-flash'),
    timeoutSec: parseInt(env.REQUEST_TIMEOUT_SEC || '45', 10),
  };
}

async function makeSapisidHash(sapisid) {
  const time = Math.floor(Date.now() / 1000);
  const orig = 'https://gemini.google.com';
  const data = `${time} ${sapisid} ${orig}`;
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(data));
  const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `SAPISIDHASH ${time}_${hex}`;
}

function buildGeminiPayload(prompt, modelId = 1, thinkMode = 4, xsrfToken = null) {
  const inner = new Array(80).fill(null);
  inner[0] = [prompt, 0, null, null, null, null, 0];
  inner[1] = ['en'];
  inner[2] = ['', '', '', null, null, null, null, null, null, ''];
  inner[6] = [0];
  inner[7] = 1;
  inner[10] = 1;
  inner[11] = 0;
  inner[17] = [[thinkMode]];
  inner[18] = 0;
  inner[27] = 1;
  inner[30] = [4];
  inner[41] = [2];
  inner[53] = 0;
  inner[59] = crypto.randomUUID();
  inner[61] = [];
  inner[68] = 1;
  inner[79] = modelId;

  const outer = [null, JSON.stringify(inner)];
  const params = new URLSearchParams();
  params.append('f.req', JSON.stringify(outer));
  if (xsrfToken || CACHED_XSRF) {
    params.append('at', xsrfToken || CACHED_XSRF);
  }
  return params.toString();
}

async function callGeminiStreamGenerate(prompt, modelName, config, retryCount = 0) {
  const modelInfo = MODELS[modelName] || MODELS['gemini-3.6-flash'];
  const reqid = Math.floor(Date.now() / 1000) % 1000000;
  const url = `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${config.geminiBl}&hl=en&_reqid=${reqid}&rt=c`;

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Origin': 'https://gemini.google.com',
    'Referer': 'https://gemini.google.com/app',
    'X-Same-Domain': '1',
    'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  if (config.cookieString) {
    headers['Cookie'] = config.cookieString;
    const match = config.cookieString.match(/SAPISID=([^;]+)/);
    if (match) {
      headers['Authorization'] = await makeSapisidHash(match[1].trim());
    }
  }

  const body = buildGeminiPayload(prompt, modelInfo.mode, modelInfo.think, CACHED_XSRF);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutSec * 1000);

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await resp.text();

  if (resp.status === 400 && text.includes('xsrf') && retryCount < 2) {
    const xsrfMatch = text.match(/\["xsrf","([^"]+)"/);
    if (xsrfMatch && xsrfMatch[1]) {
      CACHED_XSRF = xsrfMatch[1];
      return callGeminiStreamGenerate(prompt, modelName, config, retryCount + 1);
    }
  }

  if (!resp.ok) {
    throw new Error(`Gemini upstream error (${resp.status}): ${text.slice(0, 160)}`);
  }

  return text;
}

function extractTextFromGeminiResponse(rawText) {
  if (!rawText) return '';
  const lines = rawText.split('\n');
  let finalResponse = '';

  for (const line of lines) {
    if (line.includes('wrb.fr')) {
      try {
        const parsed = JSON.parse(line);
        if (parsed[0] && parsed[0][2]) {
          const inner = JSON.parse(parsed[0][2]);
          const textBlock = inner[4]?.[0]?.[1]?.[0];
          if (textBlock && textBlock.length > finalResponse.length) {
            finalResponse = textBlock;
          }
        }
      } catch (e) {}
    }
  }

  return finalResponse
    .replace(/```(?:python|javascript|text)\?code_(?:reference|stdout)&code_event_index=\d+\n[\s\S]*?```\n?/g, '')
    .trim();
}

/**
 * Internal LLM Client adapter with explicit Cookie toggle:
 * useCookie = false -> Guest anonymous mode (ideal for router/queries, 0 account pollution)
 * useCookie = true  -> Authenticated Pro mode (ideal for synthesis)
 */
class InternalLLMAdapter {
  constructor(env, modelOverride = null, useCookie = true) {
    this.config = getRequestConfig(env);
    this.model = modelOverride || this.config.defaultModel;
    if (!useCookie) {
      this.config = { ...this.config, cookieString: null };
    }
  }

  async complete(messages, options = {}) {
    const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    const raw = await callGeminiStreamGenerate(prompt, this.model, this.config);
    return extractTextFromGeminiResponse(raw);
  }

  async *stream(messages, options = {}) {
    const prompt = messages.map(m => m.content).join('\n\n');
    const raw = await callGeminiStreamGenerate(prompt, this.model, this.config);
    const fullText = extractTextFromGeminiResponse(raw);

    const words = fullText.split(' ');
    for (let i = 0; i < words.length; i++) {
      yield (i === 0 ? '' : ' ') + words[i];
      if (i % 3 === 0) {
        await new Promise(r => setTimeout(r, 10));
      }
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const config = getRequestConfig(env);

    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({
        status: 'online',
        service: 'Unified Two-Tier Deep Research Engine',
        model: config.defaultModel,
        authenticated: !!config.cookieString,
        xsrfCached: !!CACHED_XSRF,
        limits: {
          MAX_PER_QUERY: settings.MAX_PER_QUERY || 5,
          MAX_WORKERS: settings.MAX_WORKERS || 5,
          MAX_CHARS: settings.MAX_CHARS || 12000,
          MIN_SEARCH_ANGLES: settings.MIN_SEARCH_ANGLES || 5,
          MAX_SEARCH_ANGLES: settings.MAX_SEARCH_ANGLES || 7
        }
      }, null, 2), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // OpenAI Chat Completions API endpoint
    if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
      try {
        const body = await request.json();
        const model = body.model || config.defaultModel;
        const messages = body.messages || [];
        const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
        const raw = await callGeminiStreamGenerate(prompt, model, config);
        const text = extractTextFromGeminiResponse(raw);

        return new Response(JSON.stringify({
          id: 'chatcmpl-' + crypto.randomUUID().slice(0, 8),
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }]
        }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: { message: err.message } }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }

    // Deep Research SSE Stream endpoint (/api/research/stream)
    if (url.pathname === '/api/research/stream' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      const query = (body.query || '').trim();
      const sessionId = body.session_id || 'default_session';
      if (!query) {
        return new Response(JSON.stringify({ error: 'Query parameter is required' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      async function sendSSE(evt_type, data) {
        try {
          const payload = JSON.stringify({ event: evt_type, type: evt_type, data });
          await writer.write(encoder.encode(`data: ${payload}\n\n`));
        } catch (e) {}
      }

      ctx.waitUntil((async () => {
        try {
          const history = SESSIONS.get(sessionId) || [];
          
          // Phase 1: Tier 1 - Anonymous Guest Router (No Cookie -> Zero History Pollution)
          await sendSSE('stage', { text: 'Analyzing query & conversation context...' });
          const currentYear = new Date().getFullYear();
          const currentDateStr = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

          const routerClient = new InternalLLMAdapter(env, "gemini-3.6-flash", false);
          const route = await routeIntent(routerClient, query, history, currentYear, currentDateStr);

          // Fast path: Casual greeting
          if (!route.needs_search) {
            await sendSSE('router', { needs_search: false, reason: route.reason || 'Conversational query.' });
            await sendSSE('stage', { text: 'Generating direct response from memory...' });

            const directMessages = [
              ...history.slice(-4),
              { role: 'user', content: query }
            ];

            const directClient = new InternalLLMAdapter(env, "gemini-3.1-pro", true);
            for await (const chunk of directClient.stream(directMessages)) {
              await sendSSE('token', chunk);
            }

            await sendSSE('complete', { status: 'success' });
            return;
          }

          // Phase 2: Formulate 5-7 Search Perspectives
          const angles = (route.search_angles && route.search_angles.length >= 3)
            ? route.search_angles.slice(0, settings.MAX_SEARCH_ANGLES || 7)
            : [
                `${query} top rated recommendations`,
                `best similar alternatives like ${query}`,
                `hidden gems and psychological thrillers like ${query}`,
                `${query} mystery survival show comparisons`,
                `community discussion and must watch series like ${query}`
              ];

          await sendSSE('queries', { angles, queries: angles });

          // Phase 3: High-Concurrency Live Search (With Video Filter)
          await sendSSE('stage', { text: `Dispatching ${angles.length} search angles across edge workers...` });
          const searchPromises = angles.map(q => liveSearch(q, settings.MAX_PER_QUERY || 5));
          const searchResultsArrays = await Promise.all(searchPromises);

          // Deduplicate harvested links
          const seenUrls = new Set();
          const harvestQueue = [];

          angles.forEach((angle, idx) => {
            const results = searchResultsArrays[idx] || [];
            results.forEach(res => {
              if (res.url && !seenUrls.has(res.url)) {
                seenUrls.add(res.url);
                harvestQueue.push({ ...res, query_source: angle });
              }
            });
          });

          await sendSSE('stage', { text: `Discovered ${harvestQueue.length} authoritative sources. Starting parallel extraction...` });

          // Phase 4: Parallel Deep Extraction with Fallback
          const topDocsToScrape = harvestQueue.slice(0, (settings.MAX_WORKERS || 5) * 2);
          const scrapePromises = topDocsToScrape.map(async (doc) => {
            await sendSSE('scraped_page', { title: doc.title, url: doc.url });
            const content = await scrapePage(doc.url, settings.MAX_CHARS || 12000);
            return content ? { ...doc, content } : null;
          });

          const scrapedDocs = (await Promise.all(scrapePromises)).filter(Boolean);

          await sendSSE('stage', { text: `Harvested ${scrapedDocs.length} dense evidence records. Synthesizing comprehensive intelligence...` });

          // Phase 5: Tier 2 - Authenticated Pro Synthesis (With Cookie -> Full Reasoning)
          const synthesisPrompt = buildSynthesisPrompt(query, scrapedDocs, history, currentYear, currentDateStr);
          const synthesisMessages = [
            { role: 'system', content: 'You are an elite, objective research investigator and synthesizer.' },
            { role: 'user', content: synthesisPrompt }
          ];

          const proClient = new InternalLLMAdapter(env, "gemini-3.1-pro", true);
          let fullResponse = '';
          for await (const chunk of proClient.stream(synthesisMessages)) {
            fullResponse += chunk;
            await sendSSE('token', chunk);
          }

          history.push({ role: 'user', content: query });
          history.push({ role: 'assistant', content: fullResponse });
          SESSIONS.set(sessionId, history.slice(-10));

          await sendSSE('complete', { status: 'success' });
        } catch (err) {
          console.error('Streaming pipeline error:', err);
          await sendSSE('error', { message: err.message || 'Pipeline execution failed' });
        } finally {
          try {
            await writer.close();
          } catch (e) {}
        }
      })());

      return new Response(readable, {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        }
      });
    }

    return new Response(JSON.stringify({ error: 'Endpoint Not Found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
};
