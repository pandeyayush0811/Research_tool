# 🔬 Deep Research AI (Production: Vercel + Cloudflare Edge)

Production-grade, modular, self-hosted autonomous Deep Research Agent.

---

## 📁 Architecture

```
deep_research_prod/
├── frontend/                  <-- DEPLOY THIS TO VERCEL (1-Click)
│   ├── index.html             (Claude-style Minimal UI)
│   ├── style.css              (Dark theme & Thinking Accordion)
│   ├── app.js                 (EventSource SSE Stream parser)
│   └── vercel.json            (Vercel SPA routing)
│
└── backend/                   <-- DEPLOY THIS TO CLOUDFLARE WORKERS
    ├── config/
    │   ├── system_prompt_investigator.md  (100% Exact System Prompt)
    │   └── settings.json                  (MAX_PER_QUERY=3, MAX_WORKERS=4, MAX_CHARS=12000, 5-7 angles)
    ├── tools/
    │   ├── search.js          (DuckDuckGo + Jina Search parallel fan-out)
    │   └── scraper.js         (Parallel Jina Reader scraper)
    ├── core/
    │   ├── router.js          (100% Exact router prompt & lexical integrity rules)
    │   ├── synthesizer.js     (100% Exact grounded synthesis instructions)
    │   └── llm_client.js      (Gemini Web2API / OpenAI connector)
    ├── worker.js              (FastAPI-like edge router with SSE stream & CORS)
    └── wrangler.jsonc         (Cloudflare Worker config)
```

---

## 🚀 2-Minute Deployment Guide

### Step 1: Deploy Backend (Cloudflare Worker)
1. Push `backend/` to GitHub (or deploy via Cloudflare dashboard / `npx wrangler deploy`).
2. Set Environment Variable in Cloudflare:
   - `GEMINI_PROXY_URL` = `https://your-gemini-worker.workers.dev/v1`
3. You will receive your backend URL, for example:  
   👉 `https://deep-research-engine.<your-account>.workers.dev`

### Step 2: Deploy Frontend (Vercel)
1. Push `frontend/` to GitHub (or drag-and-drop into [Vercel.com](https://vercel.com)).
2. In `app.js` or in browser `localStorage`, set:
   `localStorage.setItem('dr_backend_url', 'https://deep-research-engine.<your-account>.workers.dev')`
3. Your app is live instantly with 0ms cold-start on your smartphone:  
   👉 `https://deep-research.vercel.app`
