/**
 * Parallel Page Scraper Tool for Cloudflare Edge using Jina Reader + Direct Fallback.
 * Reads full web pages and extracts clean markdown / dense text.
 */

export async function scrapePage(url, maxChars = 12000) {
  if (!url || typeof url !== 'string') return '';

  // 1. Skip non-text domains
  if (/youtube\.com|youtu\.be|tiktok\.com|instagram\.com/i.test(url)) {
    return '';
  }

  // 2. Primary: Jina AI Reader
  try {
    const cleanTarget = url.replace(/^https?:\/\//i, 'https://');
    const jinaUrl = `https://r.jina.ai/${cleanTarget}`;
    const resp = await fetch(jinaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-Timeout': '10'
      }
    });

    if (resp.ok) {
      const text = await resp.text();
      if (text && text.length > 150) {
        return text.length > maxChars ? text.slice(0, maxChars) + '\n\n... [Truncated]' : text;
      }
    }
  } catch (err) {
    console.warn(`Jina scrape failed for ${url}:`, err.message);
  }

  // 3. Secondary: Direct HTML Extraction Fallback
  try {
    const directResp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (directResp.ok) {
      const html = await directResp.text();
      const cleanText = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanText.length > 200) {
        return cleanText.length > maxChars ? cleanText.slice(0, maxChars) + '\n\n... [Truncated]' : cleanText;
      }
    }
  } catch (e) {}

  return '';
}
