/**
 * Parallel Page Scraper Tool for Cloudflare Edge using Jina Reader.
 * Reads full web pages and extracts clean markdown text.
 */

export async function scrapePage(url, maxChars = 12000) {
  try {
    // Skip video streaming links that don't have text articles
    if (/youtube\.com|youtu\.be|tiktok\.com|instagram\.com/i.test(url)) {
      return '';
    }

    const cleanTarget = url.replace(/^https?:\/\//i, 'https://');
    const jinaUrl = `https://r.jina.ai/${cleanTarget}`;
    const resp = await fetch(jinaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'X-Timeout': '15'
      }
    });

    if (resp.ok) {
      const text = await resp.text();
      if (text && text.length > 150) {
        return text.length > maxChars ? text.slice(0, maxChars) + '\n\n... [Truncated]' : text;
      }
    }
  } catch (err) {
    console.warn(`Scrape failed for ${url}:`, err.message);
  }
  return '';
}
