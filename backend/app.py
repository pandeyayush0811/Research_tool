"""
Production Modular Backend Server with CORS for Vercel Frontend.
Supports SSE real-time streaming, dynamic limits from .env, and dual-engine LLM.
"""
import os
import json
import asyncio
import threading
from pathlib import Path
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

from agent import stream_research_events, get_llm_client

app = FastAPI(title="Deep Research Production Engine", version="2.0.0")

# Enable CORS for Vercel and any frontend domain
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSIONS: Dict[str, List[Dict[str, str]]] = {}


class ChatRequest(BaseModel):
    query: str
    session_id: Optional[str] = "default"
    custom_proxy_url: Optional[str] = None
    custom_model: Optional[str] = None
    custom_openai_key: Optional[str] = None


@app.get("/api/health")
async def health():
    return {
        "status": "online",
        "service": "Deep Research Production Engine",
        "proxy_url": os.getenv("GEMINI_PROXY_URL", "http://127.0.0.1:8081/v1"),
        "model": os.getenv("GEMINI_PROXY_MODEL", "gemini-3.7-flash"),
        "limits": {
            "MAX_PER_QUERY": int(os.getenv("MAX_PER_QUERY", "3")),
            "MAX_WORKERS": int(os.getenv("MAX_WORKERS", "4")),
            "MAX_CHARS": int(os.getenv("MAX_CHARS", "12000")),
            "MIN_SEARCH_ANGLES": int(os.getenv("MIN_SEARCH_ANGLES", "5")),
            "MAX_SEARCH_ANGLES": int(os.getenv("MAX_SEARCH_ANGLES", "7")),
        }
    }


@app.post("/api/research/stream")
async def research_stream(req: ChatRequest):
    session_id = req.session_id or "default"
    history = SESSIONS.get(session_id, [])
    
    q: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def producer():
        try:
            generator = stream_research_events(
                req.query,
                history=history,
                custom_proxy_url=req.custom_proxy_url,
                custom_model=req.custom_model,
                custom_openai_key=req.custom_openai_key
            )
            for event in generator:
                loop.call_soon_threadsafe(q.put_nowait, event)
        except Exception as e:
            loop.call_soon_threadsafe(q.put_nowait, {"event": "error", "data": str(e)})
        finally:
            loop.call_soon_threadsafe(q.put_nowait, None)

    threading.Thread(target=producer, daemon=True).start()

    async def event_generator():
        full_text = ""
        while True:
            item = await q.get()
            if item is None:
                break
            evt_type = item.get("event", "message")
            data = item.get("data", {})
            if evt_type == "token":
                full_text += str(data)
            payload = json.dumps({"event": evt_type, "data": data}, ensure_ascii=False)
            yield f"data: {payload}\n\n"

        if full_text:
            if session_id not in SESSIONS:
                SESSIONS[session_id] = []
            SESSIONS[session_id].append({"role": "user", "content": req.query})
            SESSIONS[session_id].append({"role": "assistant", "content": full_text})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.post("/api/clear")
async def clear_session(req: Dict[str, str]):
    session_id = req.get("session_id", "default")
    if session_id in SESSIONS:
        SESSIONS[session_id] = []
    return {"status": "cleared", "session_id": session_id}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8787))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"Deep Research Backend running at http://localhost:{port}")
    uvicorn.run(app, host=host, port=port)
