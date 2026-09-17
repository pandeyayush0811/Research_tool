/**
 * Parallel Page Scraper Tool for Cloudflare Edge using Jina Reader.
 * Reads full web pages and extracts clean markdown text.
 */

export async function scrapePage(url, maxChars = 12000) {
  try {
    const jinaUrl = `https://r.jina.ai/${url.replace(/https?:\/\//, 'https://')}`;
    const resp = await fetch(jinaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DeepResearchAgent/2.0)',
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
