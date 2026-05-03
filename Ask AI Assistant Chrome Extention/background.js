// ── One-off messages (e.g. openSettings) ────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openSettings') {
    chrome.runtime.openOptionsPage();
    sendResponse({ status: 'opening' });
    return true;
  }
});

// ── Long-lived port for streaming AI responses ───────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai-stream') return;

  port.onMessage.addListener(async (request) => {
    if (request.action !== 'askAI') return;

    try {
      await handleAIRequest(
        {
          prompt:      request.prompt,
          context:     request.context,
          pageContext: request.pageContext  || { title: '', description: '' },
          chatHistory: request.chatHistory || [],
        },
        port
      );
    } catch (err) {
      // Only post if port is still open
      try { port.postMessage({ error: err.message }); } catch (_) {}
    }
  });
});

/**
 * Assemble the structured, context-aware prompt and dispatch
 * it to the configured AI provider.
 *
 * Prompt hierarchy (highest priority last so the model focuses on it):
 *   1. System instruction
 *   2. Page context  (title + meta description)
 *   3. Chat history  (sliding window — previous turns)
 *   4. Highlighted text  (CRITICAL — must be prioritised)
 *   5. User question
 *
 * @param {{ prompt, context, pageContext, chatHistory }} opts
 * @param {chrome.runtime.Port} port
 */
async function handleAIRequest({ prompt, context, pageContext, chatHistory }, port) {
  const data = await chrome.storage.local.get(['provider', 'model', 'apiKey']);
  const provider = data.provider || 'ollama';
  const model    = data.model    || 'llama3.2:3b';
  const apiKey   = data.apiKey;

  console.debug('[AI Assistant] provider:', provider, '| model:', model);

  // ── Build message array ─────────────────────────────────────
  const messages = [];

  // 1. System prompt
  messages.push({
    role: 'system',
    content: 'You are a helpful AI web assistant. Be concise, accurate, and friendly.',
  });

  // 2. Page context (if available)
  if (pageContext.title || pageContext.description) {
    const parts = [];
    if (pageContext.title)       parts.push(`Title: "${pageContext.title}"`);
    if (pageContext.description) parts.push(`Description: "${pageContext.description}"`);
    messages.push({
      role: 'system',
      content: `You are currently assisting the user on a webpage. ${parts.join('. ')}. Use this for general context only.`,
    });
  }

  // 3. Prior conversation turns (sliding window)
  if (Array.isArray(chatHistory) && chatHistory.length > 0) {
    chatHistory.forEach(({ role, content }) => {
      if (role === 'user' || role === 'assistant') {
        messages.push({ role, content });
      }
    });
  }

  // 4 + 5. Current turn: highlighted text (critical) + user question
  let userContent = '';
  if (context && context.trim()) {
    userContent +=
      `CRITICAL CONTEXT: The user has highlighted the following text on the page. ` +
      `You must prioritise this text when answering their question:\n` +
      `"${context.trim()}"\n\n`;
  }
  userContent += `User Question: ${prompt}`;
  messages.push({ role: 'user', content: userContent });

  console.debug('[AI Assistant] final messages array:', JSON.stringify(messages, null, 2));

  if (provider === 'ollama') return fetchOllama(messages, model, port);
  if (provider === 'openai') return fetchOpenAI(messages, model, apiKey, port);
  if (provider === 'gemini') return fetchGemini(messages, model, apiKey, port);
  if (provider === 'groq')   return fetchGroq(messages, model, apiKey, port);
  if (provider === 'openrouter') return fetchOpenRouter(messages, model, apiKey, port);
  throw new Error('Invalid provider selected.');
}

// ── Shared streaming helpers ─────────────────────────────────

/**
 * Read an SSE (Server-Sent Events) stream from the response body.
 * Calls onChunk(text) for each decoded token and signals done when complete.
 * Used by OpenAI-compatible APIs (OpenAI, Groq).
 */
async function readSSEStream(response, port, extractChunk) {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer    = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // Keep the last (potentially incomplete) line in the buffer
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (!trimmed.startsWith('data: ')) continue;

      try {
        const json  = JSON.parse(trimmed.slice(6));
        const chunk = extractChunk(json);
        if (chunk) {
          try { port.postMessage({ chunk }); } catch (_) { return; }
        }
      } catch {
        // Malformed JSON line — skip silently
      }
    }
  }

  try { port.postMessage({ done: true }); } catch (_) {}
}

/**
 * Read an NDJSON stream from the response body.
 * Used by Ollama's /api/chat endpoint.
 */
async function readNDJSONStream(response, port, extractChunk) {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer    = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const json  = JSON.parse(trimmed);
        const chunk = extractChunk(json);
        if (chunk) {
          try { port.postMessage({ chunk }); } catch (_) { return; }
        }
        // Ollama sets done:true on the final summary object
        if (json.done === true) {
          try { port.postMessage({ done: true }); } catch (_) {}
          return;
        }
      } catch {
        // Malformed JSON line — skip silently
      }
    }
  }

  try { port.postMessage({ done: true }); } catch (_) {}
}

// ── Provider fetch functions ─────────────────────────────────

/**
 * Ollama — /api/chat with NDJSON streaming
 */
async function fetchOllama(messages, model, port) {
  const url  = 'http://localhost:11434/api/chat';
  const body = JSON.stringify({ model, messages, stream: true });

  console.debug('[Ollama] POST', url);

  let res;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch (networkErr) {
    console.error('[Ollama] network error:', networkErr);
    throw new Error(
      `Cannot reach Ollama at ${url}. Is it running? (${networkErr.message})`
    );
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  await readNDJSONStream(res, port, (json) => json.message?.content ?? null);
}

/**
 * OpenAI — /v1/chat/completions with SSE streaming
 */
async function fetchOpenAI(messages, model, apiKey, port) {
  if (!apiKey) throw new Error('API Key missing.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  await readSSEStream(res, port, (json) => json.choices?.[0]?.delta?.content ?? null);
}

/**
 * Gemini — streamGenerateContent with SSE streaming
 */
async function fetchGemini(messages, model, apiKey, port) {
  if (!apiKey) throw new Error('API Key missing.');

  // Gemini uses a different role schema: 'user' / 'model'
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  // Prepend system messages as the first user turn
  const systemText = messages
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n');
  if (systemText) {
    contents.unshift({ role: 'user', parts: [{ text: systemText }] });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contents }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  await readSSEStream(
    res, port,
    (json) => json.candidates?.[0]?.content?.parts?.[0]?.text ?? null
  );
}

/**
 * Groq — OpenAI-compatible endpoint with SSE streaming
 */
async function fetchGroq(messages, model, apiKey, port) {
  if (!apiKey) throw new Error('API Key missing.');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  await readSSEStream(res, port, (json) => json.choices?.[0]?.delta?.content ?? null);
}

/**
 * OpenRouter — OpenAI-compatible endpoint with SSE streaming.
 * Requires two extra identification headers per OpenRouter's policy.
 */
async function fetchOpenRouter(messages, model, apiKey, port) {
  if (!apiKey) throw new Error('API Key missing.');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer':  'https://github.com/my-ai-extension',
      'X-Title':       'AI Assistant Extension',
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  await readSSEStream(res, port, (json) => json.choices?.[0]?.delta?.content ?? null);
}