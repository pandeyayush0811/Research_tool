"""
Search tool for Deep Research Agent.
Supports DDGS and Exa AI search engines with clean deduplication.
"""

import os
import json
from typing import List, Dict, Any

def live_search(query: str, max_results: int = 8) -> List[Dict[str, str]]:
    """Performs live web search and returns list of {title, url, snippet}."""
    exa_key = os.getenv("EXA_API_KEY")
    results = []

    # 1. Try Exa AI if API key is set
    if exa_key:
        try:
            from exa_py import Exa
            exa = Exa(api_key=exa_key)
            search_res = exa.search_and_contents(
                query,
                type="auto",
                num_results=max_results,
                highlights=True
            )
            for item in search_res.results:
                results.append({
                    "title": item.title or "",
                    "url": item.url,
                    "snippet": item.highlights[0] if item.highlights else (item.text[:300] if item.text else "")
                })
            if results:
                return results
        except Exception:
            pass

    # 2. High-speed DDGS
    try:
        from ddgs import DDGS
        ddgs = DDGS()
        raw_items = list(ddgs.text(query, max_results=max_results))
        seen_urls = set()
        for item in raw_items:
            url = item.get("href", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                results.append({
                    "title": item.get("title", ""),
                    "url": url,
                    "snippet": item.get("body", "")
                })
    except Exception as e:
        results.append({
            "title": "Search Error",
            "url": "",
            "snippet": f"Error performing search for '{query}': {e}"
        })

    return results
