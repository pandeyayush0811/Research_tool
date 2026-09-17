/**
 * Multi-layer High-Yield Web Page Scraper.
 * Layer 1: Jina Reader (with JINA_API_KEY if present, 4s timeout)
 * Layer 2: Direct Fast HTML Fetch (0.5s) with clean text extraction
 * Layer 3: Graceful Skip (Never hangs or blocks)
 */

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

  // Skip video and social domains that don't have text articles
  if (/youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com/i.test(url)) {
    return '';
  }

  // 1. Layer 1: Jina Reader with optional API key
  try {
    const cleanTarget = url.replace(/^https?:\/\//i, 'https://');
    const jinaUrl = `https://r.jina.ai/${cleanTarget}`;
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'X-Timeout': '4',
      'X-No-Cache': 'true'
    };
    if (key && typeof key === 'string' && key.trim()) {
      headers['Authorization'] = `Bearer ${key.trim()}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    let resp;
    try {
      resp = await fetch(jinaUrl, { headers, signal: controller.signal });
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
    // Timeout or network error -> proceed directly to Layer 2
  }

  // 2. Layer 2: Direct Fast HTML Fetch
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    let directResp;
    try {
      directResp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
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
        .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
        .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (cleanText.length > 250) {
        return cleanText.length > safeLimit ? cleanText.slice(0, safeLimit) + '\n\n... [Truncated]' : cleanText;
      }
    }
  } catch (e) {}

  // 3. Layer 3: Graceful Skip
  return '';
}
