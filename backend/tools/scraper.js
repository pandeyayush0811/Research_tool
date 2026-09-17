/**
 * Stealth Multi-layer High-Yield Web Page Scraper.
 * Features:
 * - Rotating Real Chrome/Safari/Firefox User Agents
 * - Full Sec-Ch-Ua / Sec-Fetch Stealth Browser Fingerprinting
 * - Google Search Referer Spoofing (Bypasses paywalls & bot checks)
 * - Jina Reader X-Target-Selector & Timeout Optimization
 * - Fast Resilient Fallbacks (Never hangs or crashes)
 */

const STEALTH_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
];

function getRandomUserAgent() {
  return STEALTH_USER_AGENTS[Math.floor(Math.random() * STEALTH_USER_AGENTS.length)];
}

export async function scrapePage(url, jinaApiKey = null, maxChars = 12000) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return '';

  // Handle argument swapping gracefully
  let key = jinaApiKey;
  let limit = maxChars;
  if (typeof jinaApiKey === 'number') {
    limit = jinaApiKey;
    key = (typeof maxChars === 'string') ? maxChars : null;
  }
  const safeLimit = (typeof limit === 'number' && limit > 0) ? limit : 12000;

  // Skip non-article / video / social platforms
  if (/youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|twitter\.com|x\.com/i.test(url)) {
    return '';
  }

  const selectedUa = getRandomUserAgent();

  // 1. Layer 1: Jina Reader with Stealth Google Referer & API Key
  try {
    const cleanTarget = url.replace(/^https?:\/\//i, 'https://');
    const jinaUrl = `https://r.jina.ai/${cleanTarget}`;
    
    const jinaHeaders = {
      'User-Agent': selectedUa,
      'X-Timeout': '5',
      'X-No-Cache': 'true',
      'X-Referer': 'https://www.google.com/',
      'X-Target-Selector': 'article, main, .article-body, .story-content, .entry-content, #content, .content',
      'Accept': 'text/plain, text/markdown, */*'
    };

    if (key && typeof key === 'string' && key.trim()) {
      jinaHeaders['Authorization'] = `Bearer ${key.trim()}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);

    let resp;
    try {
      resp = await fetch(jinaUrl, { headers: jinaHeaders, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (resp && resp.ok) {
      const text = await resp.text();
      if (text && text.length > 200 && !text.includes('Warning: Target URL returned error')) {
        return text.length > safeLimit ? text.slice(0, safeLimit) + '\n\n... [Truncated]' : text;
      }
    }
  } catch (err) {
    // Timeout or network blip -> proceed immediately to Layer 2 Stealth Fetch
  }

  // 2. Layer 2: Direct High-Speed Stealth HTML Fetch
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    let directResp;
    try {
      directResp = await fetch(url, {
        headers: {
          'User-Agent': selectedUa,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
          'Referer': 'https://www.google.com/',
          'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'cross-site',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
          'Cache-Control': 'max-age=0'
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (directResp && directResp.ok) {
      const html = await directResp.text();
      const cleanText = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
        .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
        .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
        .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
        .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (cleanText.length > 200) {
        return cleanText.length > safeLimit ? cleanText.slice(0, safeLimit) + '\n\n... [Truncated]' : cleanText;
      }
    }
  } catch (e) {}

  // 3. Layer 3: Graceful Skip (Return empty string so LLM only receives valid text)
  return '';
}
