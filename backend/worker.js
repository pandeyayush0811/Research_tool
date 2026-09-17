/**
 * Cloudflare Worker: Modular Deep Research Agent Engine.
 * Provides CORS headers, /api/health, and /api/research/stream SSE pipeline.
 */

import { LLMClient } from './core/llm_client.js';
import { routeIntent } from './core/router.js';
import { liveSearch } from './tools/search.js';
import { scrapePage } from './tools/scraper.js';
import { buildSynthesisPrompt } from './core/synthesizer.js';
import settings from './config/settings.json' with { type: 'json' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// In-memory sessions store (per worker instance)
const SESSIONS = new Map();

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({
        status: 'online',
        service: 'Deep Research Modular Edge Engine',
        model: env.GEMINI_PROXY_MODEL || 'gemini-3.7-flash',
        limits: settings
      }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // Clear session
    if (url.pathname === '/api/clear' && request.method === 'POST') {
      try {
        const body = await request.json();
        const sessionId = body.session_id || 'default';
        SESSIONS.delete(sessionId);
        return new Response(JSON.stringify({ status: 'cleared', session_id: sessionId }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ status: 'error', error: e.message }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          status: 400
        });
      }
    }

    // Real-Time Research Streaming endpoint
    if (url.pathname === '/api/research/stream' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS });
      }

      const userQuery = (body.query || '').trim();
      const sessionId = body.session_id || 'default';
      const history = SESSIONS.get(sessionId) || [];

      if (!userQuery) {
        return new Response('Missing query', { status: 400, headers: CORS_HEADERS });
      }

      const client = new LLMClient(env);
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentDateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      // Build SSE TransformStream
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      async function sendEvent(event, data) {
        const payload = JSON.stringify({ event, data });
        await writer.write(encoder.encode(`data: ${payload}\n\n`));
      }

      ctx.waitUntil((async () => {
        try {
          // 1. Router Stage
          await sendEvent('stage', { step: 'router', text: 'Analyzing query & conversation context...' });
          const plan = await routeIntent(client, userQuery, history, currentYear, currentDateStr);
          
          await sendEvent('router', {
            needs_search: plan.needs_search,
            reason: plan.reason,
            standalone_query: plan.standalone_query || userQuery
          });

          // Fast-path if no search needed
          if (!plan.needs_search) {
            await sendEvent('stage', { step: 'fast_path', text: 'Generating direct response from memory...' });
            const messages = [
              { role: 'system', content: `Today's Date: ${currentDateStr}. Provide a helpful, direct answer.` },
              ...history.slice(-6),
              { role: 'user', content: userQuery }
            ];

            let directText = "";
            for await (const token of client.stream(messages)) {
              directText += token;
              await sendEvent('token', token);
            }

            if (directText) {
              history.push({ role: 'user', content: userQuery }, { role: 'assistant', content: directText });
              SESSIONS.set(sessionId, history);
            }
            return;
          }

          // 2. Parallel Search Stage
          const angles = (plan.search_angles && plan.search_angles.length > 0) ? plan.search_angles : [userQuery];
          await sendEvent('queries', { angles });
          await sendEvent('stage', { step: 'searching', text: `Searching across ${angles.length} dynamic perspectives in parallel...` });

          // Run search angles concurrently via Promise.all
          const maxPerQuery = settings.MAX_PER_QUERY || 3;
          const searchPromises = angles.map(q => liveSearch(q, maxPerQuery + 2).then(results => ({ query: q, results })));
          const searchOutputs = await Promise.all(searchPromises);

          // Deduplicate URLs across all angles
          const seenUrls = new Set();
          const uniqueCandidates = [];

          for (const out of searchOutputs) {
            let count = 0;
            for (const item of out.results) {
              const url = (item.url || '').trim();
              if (!url || !url.startsWith('http')) continue;
              const normUrl = url.split('?utm_')[0].replace(/\/+$/, '');
              if (seenUrls.has(normUrl)) continue;
              seenUrls.add(normUrl);
              uniqueCandidates.push({
                url: url,
                title: item.title,
                query_source: out.query
              });
              count++;
              if (count >= maxPerQuery) break;
            }
          }

          await sendEvent('sources', { candidates: uniqueCandidates });
          await sendEvent('stage', { step: 'scraping', text: `Scraping ${uniqueCandidates.length} high-authority pages in parallel...` });

          // 3. Parallel Scrape Stage
          const maxChars = settings.MAX_CHARS || 12000;
          const scrapePromises = uniqueCandidates.map(async (cand) => {
            const content = await scrapePage(cand.url, maxChars);
            if (content && content.length > 150) {
              await sendEvent('scraped_page', {
                title: cand.title || cand.url,
                url: cand.url,
                bytes: content.length
              });
              return {
                url: cand.url,
                title: cand.title,
                query_source: cand.query_source,
                content: content
              };
            }
            return null;
          });

          const scrapedResults = (await Promise.all(scrapePromises)).filter(Boolean);

          // 4. Grounded Synthesis Stage
          await sendEvent('stage', { step: 'synthesis', text: `Synthesizing verified report from ${scrapedResults.length} authoritative sources...` });
          const synthesisPrompt = buildSynthesisPrompt(userQuery, scrapedResults, history, currentYear, currentDateStr);

          const synthMessages = [
            { role: 'system', content: 'You are an elite deep research assistant. Answer honestly, objectively, and without bias.' },
            { role: 'user', content: synthesisPrompt }
          ];

          let fullReport = "";
          for await (const token of client.stream(synthMessages)) {
            fullReport += token;
            await sendEvent('token', token);
          }

          if (fullReport) {
            history.push({ role: 'user', content: userQuery }, { role: 'assistant', content: fullReport });
            SESSIONS.set(sessionId, history);
          }

        } catch (err) {
          console.error('Pipeline error:', err);
          await sendEvent('error', err.message);
        } finally {
          try {
            await writer.close();
          } catch (e) {}
        }
      })());

      return new Response(readable, {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }
};
