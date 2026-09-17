"""
Deep Research Agent Engine with Event-Driven Real-Time Streaming for Web UI.
Supports Dual-Engine (Gemini Cloudflare / Local Proxy + OpenAI Fallback).
"""
import os
import sys
import json
import re
import datetime
import time
from pathlib import Path
from typing import List, Dict, Any, Generator, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

sys.path.insert(0, str(BASE_DIR))
from tools.search import live_search
from tools.scraper import scrape_full_page

PROMPT_FILE = BASE_DIR / "config" / "system_prompt_investigator.md"
REPORTS_DIR = BASE_DIR / "outputs" / "reports"
LATEST_REPORT_FILE = BASE_DIR / "outputs" / "LATEST_RESEARCH_REPORT.md"


def get_system_prompt() -> str:
    if PROMPT_FILE.exists():
        return PROMPT_FILE.read_text(encoding="utf-8")
    return "You are an elite deep research assistant. Answer honestly, objectively, and without bias."


import socket
import subprocess

def is_proxy_running(host="127.0.0.1", port=8081, timeout=1.0) -> bool:
    """Checks if proxy server is already listening on the port."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False


def ensure_proxy_server_running(proxy_url: Optional[str] = None):
    """Auto-starts the Gemini Web2API proxy server if targeting localhost and not running."""
    url = proxy_url or os.getenv("GEMINI_PROXY_URL", "http://localhost:8081/v1")
    if not url or ("localhost" not in url and "127.0.0.1" not in url):
        return

    port = 8081
    if is_proxy_running("127.0.0.1", port):
        return

    proxy_dir = os.getenv("GEMINI_PROXY_DIR", r"c:\Users\pande\Music\Zoho Invoice")
    server_script = Path(proxy_dir) / "start_server.py"
    if not server_script.exists():
        return

    print(f" [AUTO-LAUNCH] Starting Gemini proxy from {proxy_dir}...")
    try:
        creationflags = 0
        if sys.platform == "win32":
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP
        proc = subprocess.Popen(
            [sys.executable, str(server_script)],
            cwd=str(proxy_dir),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags
        )
        for _ in range(16):
            time.sleep(0.5)
            if is_proxy_running("127.0.0.1", port):
                print(f" [AUTO-LAUNCH] Proxy server ready on http://127.0.0.1:{port}/v1 (PID: {proc.pid})")
                return
    except Exception as e:
        print(f" [AUTO-LAUNCH] Could not auto-start proxy: {e}")

class FallbackLLMClient:
    def __init__(self, primary_client, primary_model: str, fallback_client=None, fallback_model: str = "gpt-4o-mini"):
        self.primary_client = primary_client
        self.primary_model = primary_model
        self.fallback_client = fallback_client
        self.fallback_model = fallback_model
        self.chat = self.Chat(self)

    class Chat:
        def __init__(self, parent):
            self.parent = parent
            self.completions = self.Completions(parent)

        class Completions:
            def __init__(self, parent):
                self.parent = parent

            def create(self, **kwargs):
                if self.parent.primary_client:
                    try:
                        req_kwargs = dict(kwargs)
                        req_kwargs["model"] = self.parent.primary_model
                        return self.parent.primary_client.chat.completions.create(**req_kwargs)
                    except Exception as e:
                        if not self.parent.fallback_client:
                            raise e

                if self.parent.fallback_client:
                    req_kwargs = dict(kwargs)
                    req_kwargs["model"] = self.parent.fallback_model
                    return self.parent.fallback_client.chat.completions.create(**req_kwargs)

                raise RuntimeError("No LLM client configured.")


def get_llm_client(custom_proxy_url=None, custom_model=None, custom_openai_key=None) -> FallbackLLMClient:
    ensure_proxy_server_running(custom_proxy_url)
    from openai import OpenAI
    proxy_url = custom_proxy_url or os.getenv("GEMINI_PROXY_URL", "http://localhost:8081/v1")
    proxy_model = custom_model or os.getenv("GEMINI_PROXY_MODEL", "gemini-3.7-flash")
    openai_key = custom_openai_key or os.getenv("OPENAI_API_KEY")
    openai_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    primary_client = None
    if proxy_url:
        try:
            primary_client = OpenAI(base_url=proxy_url, api_key="sk-gemini", timeout=60.0)
        except Exception:
            pass

    fallback_client = None
    if openai_key:
        try:
            fallback_client = OpenAI(api_key=openai_key, timeout=60.0)
        except Exception:
            pass

    return FallbackLLMClient(
        primary_client=primary_client,
        primary_model=proxy_model,
        fallback_client=fallback_client,
        fallback_model=openai_model
    )


def route_intent(client: FallbackLLMClient, user_query: str, history: List[Dict[str, str]], current_date_str: str, current_year: int) -> Dict[str, Any]:
    min_angles = int(os.getenv("MIN_SEARCH_ANGLES", "5"))
    max_angles = int(os.getenv("MAX_SEARCH_ANGLES", "7"))
    min_floor = max(1, min_angles - 1)
    max_ceil = max_angles + 2

    lower_q = user_query.lower().strip()
    if lower_q in ["hi", "hello", "hey", "sup", "kaisa hai", "kaise ho", "help"]:
        return {
            "needs_search": False,
            "reason": "Greeting or casual conversational check.",
            "standalone_query": user_query,
            "search_angles": []
        }

    history_snippet = ""
    if history:
        history_snippet = "RECENT CONVERSATION HISTORY:\n"
        for turn in history[-6:]:
            role = "User" if turn["role"] == "user" else "Assistant"
            content = turn["content"][:400]
            history_snippet += f"{role}: {content}\n"

    router_prompt = f"""
You are an autonomous research query router and strategist.
CURRENT DATE: {current_date_str} (Operational Year: {current_year})

{history_snippet}
LATEST USER MESSAGE:
"{user_query}"

TASK:
1. DECIDE `needs_search` (true or false):
   - Set to `false` if the user is asking to:
     * Translate, format, rephrase, or summarize something already discussed above.
     * Ask a follow-up or clarification that can be answered entirely from the existing conversation history.
     * Casual banter, thanks, or feedback.
   - Set to `true` if the user is asking for:
     * New external facts, recent news, updates, or a new topic.
     * Deeper external verification or specific new questions about a person, entity, or event.

2. IF `needs_search` is true:
   - `core_terms`: Identify the exact specific subject noun phrases, technical concepts, or entities from the user's message (e.g. "AI harness", "Kafka tombstone", "Pell's equation", "CRISPR Cas12").
   - `standalone_query`: Resolve any ambiguous pronouns ("he", "that case", "they", "point 2") using conversation history, while strictly preserving the core subject terms.
   - `search_angles`: Provide {min_angles} to {max_angles} distinct, high-signal search queries (minimum {min_floor}, maximum {max_ceil}) covering diverse angles of this specific topic.
     * UNIVERSAL LEXICAL INTEGRITY (Zero-Generalization Rule):
       NEVER drop, delete, or over-generalize specific technical terms, named entities, or jargon into broad parent categories!
       (e.g., NEVER turn 'AI harness' into generic 'AI', NEVER turn 'Kafka tombstone' into generic 'database', NEVER turn 'Pell's equation' into generic 'math').
       Every generated query MUST explicitly contain or directly focus on the specific core terms!
     * ANCHOR QUERY RULE:
       Query #1 MUST ALWAYS be a direct, targeted definition/explainer search of the exact core terms (e.g., "[core terms] definition meaning explained").
     * TEMPORAL SENSITIVITY:
       - If TIME-SENSITIVE ('now', 'latest', modern models, news): Anchor to {current_year} or freshness terms. NEVER use 2023/2024!
       - If TIMELESS/SCIENTIFIC/HISTORICAL: Do not force {current_year}. Search naturally.

OUTPUT STRICTLY IN VALID JSON:
{{
  "needs_search": true or false,
  "reason": "Brief explanation",
  "core_terms": "The exact subject terms identified",
  "standalone_query": "Context-resolved query string",
  "search_angles": ["query 1 (anchor definition)", "query 2", "query 3", "query 4", "query 5", "query 6", "query 7"]
}}
"""

    try:
        response = client.chat.completions.create(
            messages=[
                {"role": "system", "content": "You are a JSON-only query routing engine."},
                {"role": "user", "content": router_prompt}
            ],
            temperature=0.2
        )
        raw = response.choices[0].message.content.strip()
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            return json.loads(match.group(0))
    except Exception:
        pass

    return {
        "needs_search": True,
        "reason": "Default investigative search",
        "standalone_query": user_query,
        "search_angles": [user_query]
    }


def stream_research_events(
    user_query: str, 
    history: List[Dict[str, str]] = None,
    custom_proxy_url: Optional[str] = None,
    custom_model: Optional[str] = None,
    custom_openai_key: Optional[str] = None
) -> Generator[Dict[str, Any], None, None]:
    if history is None:
        history = []

    client = get_llm_client(
        custom_proxy_url=custom_proxy_url,
        custom_model=custom_model,
        custom_openai_key=custom_openai_key
    )
    now = datetime.datetime.now()
    current_date_str = now.strftime("%B %d, %Y")
    current_year = now.year

    yield {"event": "stage", "data": {"step": "router", "text": "Analyzing query & checking conversation memory..."}}

    route_plan = route_intent(client, user_query, history, current_date_str, current_year)
    needs_search = route_plan.get("needs_search", True)
    reason = route_plan.get("reason", "")

    yield {
        "event": "router",
        "data": {
            "needs_search": needs_search,
            "reason": reason,
            "standalone_query": route_plan.get("standalone_query", user_query)
        }
    }

    if not needs_search:
        yield {"event": "stage", "data": {"step": "fast_path", "text": "Generating instant response from memory..."}}
        system_prompt = get_system_prompt()
        messages = [{"role": "system", "content": f"{system_prompt}\n\nToday's Date: {current_date_str}"}]
        for turn in history[-6:]:
            messages.append({"role": turn["role"], "content": turn["content"]})
        messages.append({"role": "user", "content": user_query})

        full_response = ""
        try:
            stream = client.chat.completions.create(
                messages=messages,
                temperature=0.5,
                stream=True
            )
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                    delta = chunk.choices[0].delta.content
                    full_response += delta
                    yield {"event": "token", "data": delta}
        except Exception:
            resp = client.chat.completions.create(messages=messages, temperature=0.5)
            full_response = resp.choices[0].message.content or ""
            yield {"event": "token", "data": full_response}

        yield {
            "event": "done",
            "data": {
                "full_report": full_response,
                "sources": [],
                "searches": []
            }
        }
        return

    search_angles = route_plan.get("search_angles", [user_query])
    if not search_angles:
        search_angles = [user_query]

    yield {
        "event": "queries",
        "data": {"angles": search_angles}
    }

    yield {"event": "stage", "data": {"step": "searching", "text": f"Searching across {len(search_angles)} dynamic perspectives in parallel..."}}

    seen_urls = set()
    unique_candidates = []
    max_per_query = int(os.getenv("MAX_PER_QUERY", "3"))

    def _search_worker(q):
        try:
            items = live_search(q, max_results=max_per_query + 2)
            return {"query": q, "results": items}
        except Exception:
            return {"query": q, "results": []}

    # Parallel Search with ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(len(search_angles), 6)) as search_executor:
        search_futures = {search_executor.submit(_search_worker, q): q for q in search_angles}
        for future in as_completed(search_futures):
            res_data = future.result()
            q = res_data["query"]
            results = res_data["results"]
            yield {"event": "searching", "data": {"query": q, "count": len(results)}}
            
            count = 0
            for item in results:
                url = item.get("url", "").strip()
                if not url or not url.startswith("http"):
                    continue
                norm_url = url.split("?utm_")[0].rstrip("/")
                if any(b in norm_url.lower() for b in ["facebook.com/login", "twitter.com/login", "instagram.com/"]):
                    continue
                if norm_url not in seen_urls:
                    seen_urls.add(norm_url)
                    unique_candidates.append({
                        "url": url,
                        "title": item.get("title", ""),
                        "query_source": q
                    })
                    count += 1
                    if count >= max_per_query:
                        break

    yield {
        "event": "sources",
        "data": {"candidates": unique_candidates}
    }

    yield {"event": "stage", "data": {"step": "scraping", "text": f"Scraping {len(unique_candidates)} unique sources in parallel..."}}

    scraped_data = []
    def _scrape_worker(cand):
        url = cand["url"]
        max_chars = int(os.getenv("MAX_CHARS", "12000"))
        content = scrape_full_page(url, max_chars=max_chars)
        return {
            "url": url,
            "title": cand.get("title", ""),
            "query_source": cand.get("query_source", ""),
            "content": content,
            "bytes": len(content)
        }

    max_workers = int(os.getenv("MAX_WORKERS", "4"))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_scrape_worker, c): c for c in unique_candidates}
        for future in as_completed(futures):
            try:
                res = future.result()
                if res["bytes"] > 150:
                    scraped_data.append(res)
                    yield {
                        "event": "scraped_page",
                        "data": {
                            "title": res["title"] or res["url"],
                            "url": res["url"],
                            "bytes": res["bytes"]
                        }
                    }
            except Exception:
                pass

    yield {"event": "stage", "data": {"step": "synthesis", "text": f"Synthesizing verified report from {len(scraped_data)} authoritative pages..."}}

    system_prompt = get_system_prompt()
    evidence_blocks = []
    for idx, doc in enumerate(scraped_data, 1):
        evidence_blocks.append(
            f"--- SOURCE {idx}: {doc['title']} ---\n"
            f"URL: {doc['url']}\n"
            f"CONTENT:\n{doc['content']}\n"
        )
    evidence_text = "\n".join(evidence_blocks)

    conversation_context = ""
    if history:
        conversation_context = "\nPREVIOUS CONVERSATION CONTEXT:\n"
        for turn in history[-4:]:
            role = "User" if turn["role"] == "user" else "Assistant"
            conversation_context += f"{role}: {turn['content'][:300]}...\n"

    synthesis_instruction = f"""
CURRENT DATE: {current_date_str} (Operational Year: {current_year})

{conversation_context}
USER'S CURRENT INQUIRY:
"{user_query}"

CRAWLED & VERIFIED EVIDENCE POOL ({len(scraped_data)} Unique Sources Crawled):
{evidence_text}

INSTRUCTIONS FOR YOUR ANSWER:
1. ADAPTIVE DEPTH:
   - If quick/casual, give a direct, punchy, conversational answer.
   - If detailed/deep-dive, give an exhaustive, nuanced breakdown.
   - Default: Give a rich, engaging, well-rounded explanation.
2. NO ROBOTIC TEMPLATES: Do NOT use artificial headers like ' Deep Inquiry Dossier' or 'Section 1...'. Structure naturally with clean markdown headers and bullet points.
3. TONE & HONESTY: Match the user's language naturally (Hinglish / English). Always be 100% honest, objective, and unbiased. If facts are disputed or evolving, state so transparently.
4. CITE SOURCES: Include direct clickable markdown links [Source Name](URL) at the bottom or inline.
"""

    full_report = ""
    try:
        stream = client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": synthesis_instruction}
            ],
            temperature=0.3,
            stream=True
        )
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                delta = chunk.choices[0].delta.content
                full_report += delta
                yield {"event": "token", "data": delta}
    except Exception:
        resp = client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": synthesis_instruction}
            ],
            temperature=0.3
        )
        full_report = resp.choices[0].message.content or ""
        yield {"event": "token", "data": full_report}

    try:
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        LATEST_REPORT_FILE.write_text(full_report, encoding="utf-8")
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        slug = re.sub(r"[^a-zA-Z0-9]+", "_", user_query.lower())[:30].strip("_")
        (REPORTS_DIR / f"report_{timestamp}_{slug}.md").write_text(full_report, encoding="utf-8")
    except Exception:
        pass

    yield {
        "event": "done",
        "data": {
            "full_report": full_report,
            "sources": [{"title": d["title"], "url": d["url"]} for d in scraped_data],
            "searches": search_angles
        }
    }
