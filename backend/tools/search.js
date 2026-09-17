// Search Tool for Cloudflare Worker Deep Research
// Multi-engine resilient search: Jina Search (if key provided) -> DuckDuckGo HTML/Lite -> Wikipedia API

const EXCLUDED_PATTERNS = [
  'youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com', 
  'facebook.com', 'twitter.com', 'x.com', 'pinterest.com',
  'reddit.com', 'quora.com'
];

function isCleanUrl(url) {
  if (!url || !url.startsWith('http')) return false;
  const lower = url.toLowerCase();
  for (const pat of EXCLUDED_PATTERNS) {
    if (lower.includes(pat)) return false;
  }
  return true;
}

export async function searchJina(query, apiKey, maxResults = 5) {
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Retain-Images': 'none'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.data && Array.isArray(data.data)) {
      const results = [];
      for (const item of data.data) {
        if (item.url && isCleanUrl(item.url)) {
          results.push({
            title: item.title || 'Source',
            url: item.url,
            snippet: item.description || item.content?.slice(0, 300) || ''
          });
        }
        if (results.length >= maxResults) break;
      }
      return results.length > 0 ? results : null;
    }
  } catch (err) {
    console.error('Jina search error:', err.message);
  }
  return null;
}

export async function searchDuckDuckGo(query, maxResults = 5) {
  const urlsToTry = [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
  ];

  for (const targetUrl of urlsToTry) {
    try {
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        signal: AbortSignal.timeout(5000)
      });

      if (!res.ok) continue;
      const html = await res.text();
      const results = [];
      
      const linkRegex = /<a[^>]+class="(?:result__snippet|result__url|result__a|result-link)"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        let rawUrl = match[1];
        if (rawUrl.includes('uddg=')) {
          const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
          if (uddgMatch) rawUrl = decodeURIComponent(uddgMatch[1]);
        }
        if (isCleanUrl(rawUrl) && !results.some(r => r.url === rawUrl)) {
          const title = match[2].replace(/<[^>]+>/g, '').trim();
          results.push({
            title: title || 'Web Source',
            url: rawUrl,
            snippet: ''
          });
        }
      }

      if (results.length > 0) return results;
    } catch (err) {
      console.error(`DDG error on ${targetUrl}:`, err.message);
    }
  }
  return [];
}

export async function searchWikipedia(query, maxResults = 3) {
  try {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${maxResults}&namespace=0&format=json`, {
      headers: {
        'User-Agent': 'DeepResearchAgent/1.0 (research@deepresearch.org)'
      },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    const results = [];
    if (data && data[1] && data[3]) {
      for (let i = 0; i < data[1].length; i++) {
        const title = data[1][i];
        const snippet = (data[2] && data[2][i]) || '';
        const url = data[3][i];
        if (url && isCleanUrl(url)) {
          results.push({ title, snippet, url });
        }
      }
    }
    return results;
  } catch (err) {
    console.error('Wikipedia search error:', err.message);
    return [];
  }
}

export async function executeSearch(query, apiKey = null, maxResults = 5) {
  // 1. Try Jina search if API key exists
  if (apiKey) {
    const jinaResults = await searchJina(query, apiKey, maxResults);
    if (jinaResults && jinaResults.length > 0) {
      return jinaResults;
    }
  }

  // 2. Try DuckDuckGo
  const ddgResults = await searchDuckDuckGo(query, maxResults);
  if (ddgResults && ddgResults.length > 0) {
    return ddgResults;
  }

  // 3. Fallback to Wikipedia API
  const wikiResults = await searchWikipedia(query, maxResults);
  return wikiResults;
}

export const liveSearch = executeSearch;
