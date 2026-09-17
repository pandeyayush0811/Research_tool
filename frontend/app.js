// Production Vercel Client - Deep Research AI
// Connected to your live Cloudflare Edge Worker
const BACKEND_URL = localStorage.getItem('dr_backend_url') || 'https://research-tool.pandeyayush0811.workers.dev';
// Claude-style Minimal Web Client for Deep Research
document.addEventListener('DOMContentLoaded', () => {
  const userInput = document.getElementById('userInput');
  const sendButton = document.getElementById('sendButton');
  const chatContainer = document.getElementById('chatContainer');
  const emptyHero = document.getElementById('emptyHero');
  const conversation = document.getElementById('conversation');
  const newChatBtn = document.getElementById('newChatBtn');
  const statusHint = document.getElementById('statusHint');

  let isGenerating = false;
  let currentSessionId = 'claude_session_' + Date.now();

  marked.setOptions({
    highlight: function(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
    breaks: true
  });

  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 160) + 'px';
    sendButton.disabled = userInput.value.trim().length === 0 || isGenerating;
  });

  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendButton.disabled) {
        handleSend();
      }
    }
  });

  sendButton.addEventListener('click', handleSend);

  newChatBtn.addEventListener('click', async () => {
    conversation.innerHTML = '';
    emptyHero.style.display = 'block';
    currentSessionId = 'claude_session_' + Date.now();
    await fetch((BACKEND_URL ? BACKEND_URL.replace(/\/+$/, '') : '') + '/api/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: currentSessionId })
    });
    userInput.value = '';
    userInput.style.height = 'auto';
    sendButton.disabled = true;
    userInput.focus();
  });

  async function handleSend() {
    const text = userInput.value.trim();
    if (!text || isGenerating) return;

    isGenerating = true;
    sendButton.disabled = true;
    emptyHero.style.display = 'none';

    // Append user message
    appendUserMessage(text);
    userInput.value = '';
    userInput.style.height = 'auto';

    // Create Claude-style assistant message with thinking accordion
    const assistantUi = createAssistantMessage();
    conversation.appendChild(assistantUi.row);
    scrollToBottom();

    const startTime = Date.now();

    try {
      const response = await fetch((BACKEND_URL ? BACKEND_URL.replace(/\/+$/, '') : '') + '/api/research/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: text,
          session_id: currentSessionId
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let markdownOutput = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop();

        for (const block of lines) {
          if (!block.startsWith('data: ')) continue;
          try {
            const payload = JSON.parse(block.replace('data: ', ''));
            handleStreamPayload(payload, assistantUi, (token) => {
              markdownOutput += token;
              assistantUi.responseEl.innerHTML = marked.parse(markdownOutput);
              scrollToBottom();
            });
          } catch (e) {
            console.error('SSE JSON error:', e);
          }
        }
      }

      // Finish thinking block
      const durationSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
      assistantUi.thinkingDot.classList.remove('pulsing');
      assistantUi.thinkingDot.style.backgroundColor = '#6d6b65';
      assistantUi.thinkingTitle.textContent = `Thought for ${durationSec}s`;
      assistantUi.thinkingBox.classList.add('collapsed');

    } catch (err) {
      console.error('Error:', err);
      assistantUi.responseEl.innerHTML = `<p style="color:#ef4444;">Error: ${err.message}</p>`;
    } finally {
      isGenerating = false;
      sendButton.disabled = userInput.value.trim().length === 0;
      userInput.focus();
    }
  }

  function appendUserMessage(text) {
    const row = document.createElement('div');
    row.className = 'user-row';
    const bubble = document.createElement('div');
    bubble.className = 'user-bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    conversation.appendChild(row);
  }

  function createAssistantMessage() {
    const row = document.createElement('div');
    row.className = 'assistant-row';

    // Thinking Box (Claude Accordion)
    const thinkingBox = document.createElement('div');
    thinkingBox.className = 'thinking-box';
    thinkingBox.innerHTML = `
      <div class="thinking-header">
        <div class="thinking-left">
          <div class="thinking-dot pulsing"></div>
          <span class="thinking-title">Thinking...</span>
        </div>
        <span class="thinking-chevron">▾</span>
      </div>
      <div class="thinking-body"></div>
    `;

    const thinkingHeader = thinkingBox.querySelector('.thinking-header');
    const thinkingBody = thinkingBox.querySelector('.thinking-body');
    const thinkingDot = thinkingBox.querySelector('.thinking-dot');
    const thinkingTitle = thinkingBox.querySelector('.thinking-title');

    thinkingHeader.addEventListener('click', () => {
      thinkingBox.classList.toggle('collapsed');
    });

    // Response Container
    const responseEl = document.createElement('div');
    responseEl.className = 'assistant-response';

    row.appendChild(thinkingBox);
    row.appendChild(responseEl);

    return {
      row,
      thinkingBox,
      thinkingBody,
      thinkingDot,
      thinkingTitle,
      responseEl
    };
  }

  function handleStreamPayload(payload, ui, onToken) {
    const evt = payload.event;
    const data = payload.data;

    switch (evt) {
      case 'stage':
        addThinkingStep(ui.thinkingBody, data.text, true);
        break;

      case 'router':
        if (!data.needs_search) {
          addThinkingStep(ui.thinkingBody, `Direct answer: ${data.reason}`, false);
        } else {
          addThinkingStep(ui.thinkingBody, `Analyzing intent: Web research required`, false);
        }
        break;

      case 'queries':
        if (data.angles && data.angles.length > 0) {
          addThinkingStep(ui.thinkingBody, `Searching across ${data.angles.length} perspectives: ${data.angles.join(' • ')}`, false);
        }
        break;

      case 'scraped_page':
        addThinkingStep(ui.thinkingBody, `Read source: ${data.title || data.url}`, false);
        break;

      case 'token':
        onToken(data);
        break;

      case 'error':
        addThinkingStep(ui.thinkingBody, `Error encountered: ${data}`, true);
        break;
    }
  }

  function addThinkingStep(body, text, isHighlight) {
    const step = document.createElement('div');
    step.className = 'thinking-step' + (isHighlight ? ' highlight' : '');
    step.textContent = text;
    body.appendChild(step);
    scrollToBottom();
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
});
