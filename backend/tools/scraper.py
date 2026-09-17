"""
Full-Page Scraper tool for Deep Research Agent.
Extracts clean, readable Markdown from any web page without ads or paywalls.
"""

import urllib.request
import json
import re

def scrape_full_page(url: str, max_chars: int = 25000) -> str:
    """Extracts clean full-page text content using Jina Reader and fallback mechanisms."""
    if not url or not url.startswith("http"):
        return "Invalid URL."

    content = ""

    # Method 1: Jina Reader (High-grade markdown converter)
    try:
        jina_url = f"https://r.jina.ai/{url}"
        req = urllib.request.Request(
            jina_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Accept": "text/markdown, text/plain, text/html"
            }
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read().decode("utf-8", errors="ignore")
    except Exception:
        pass

    # Method 2: Direct HTTP fetch fallback
    if not content or len(content) < 200:
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw_html = resp.read().decode("utf-8", errors="ignore")
                # Basic HTML tag stripping
                clean = re.sub(r"<script.*?</script>", "", raw_html, flags=re.DOTALL | re.IGNORECASE)
                clean = re.sub(r"<style.*?</style>", "", clean, flags=re.DOTALL | re.IGNORECASE)
                clean = re.sub(r"<[^>]+>", " ", clean)
                content = re.sub(r"\s+", " ", clean).strip()
        except Exception as e:
            if not content:
                content = f"Could not read page {url}: {e}"

    # Return bounded character slice
    return content[:max_chars]
