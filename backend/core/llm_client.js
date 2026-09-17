/**
 * Dual-Engine LLM Client for Cloudflare Workers.
 * Connects to Gemini Web2API proxy and streams response tokens.
 */

export class LLMClient {
  constructor(env) {
    this.proxyUrl = env.GEMINI_PROXY_URL || 'http://localhost:8081/v1';
    this.model = env.GEMINI_PROXY_MODEL || 'gemini-3.7-flash';
    this.apiKey = env.GEMINI_API_KEY || 'sk-gemini';
  }

  async complete(messages, options = {}) {
    const url = `${this.proxyUrl.replace(/\/+$/, '')}/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        temperature: options.temperature || 0.3,
        stream: false
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`LLM call failed (${resp.status}): ${err}`);
    }

    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async *stream(messages, options = {}) {
    const url = `${this.proxyUrl.replace(/\/+$/, '')}/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        temperature: options.temperature || 0.4,
        stream: true
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`LLM Stream error (${resp.status}): ${err}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch (e) {}
        }
      }
    }
  }
}
