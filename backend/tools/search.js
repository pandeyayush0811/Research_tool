/**
 * Multi-provider Parallel Search Tool for Cloudflare Edge.
 * Supports Jina Search (s.jina.ai) and DuckDuckGo HTML API without rate limits.
 */

export async function liveSearch(query, maxResults = 5) {
  try {
    // 1. Try Jina AI Search (Clean JSON for AI agents, no rate limits on Edge)
    const jinaUrl = `https://s.jina.ai/${encodeURIComponent(query)}`;
    const resp = await fetch(jinaUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data && data.data && Array.isArray(data.data)) {
        return data.data.slice(0, maxResults).map(item => ({
          title: item.title || query,
          url: item.url,
          snippet: item.description || item.content?.slice(0, 300) || ''
        }));
      }
    }
  } catch (e) {
    console.warn(`Jina search fallback for '${query}':`, e.message);
  }

  // 2. DuckDuckGo Fallback via Edge fetch
  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(ddgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });

    if (resp.ok) {
      const html = await resp.text();
      const results = [];
      const linkRegex = /<a class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      const titleRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      
      let match;
      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        let rawUrl = match[1];
        if (rawUrl.includes('uddg=')) {
          const parts = rawUrl.split('uddg=');
          if (parts[1]) rawUrl = decodeURIComponent(parts[1].split('&')[0]);
        }
        if (rawUrl.startsWith('http')) {
          results.push({
            title: match[2]?.replace(/<[^>]*>/g, '').trim() || query,
            url: rawUrl,
            snippet: ''
          });
        }
      }
      if (results.length > 0) return results;
    }
  } catch (err) {
    console.error(`Search error for '${query}':`, err.message);
  }

  return [];
}
