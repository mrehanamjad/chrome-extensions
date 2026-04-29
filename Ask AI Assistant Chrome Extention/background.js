chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "openSettings") {
    chrome.runtime.openOptionsPage();
    sendResponse({ status: "opening" });
    return true;
  }

  if (request.action === "askAI") {
    handleAIRequest({
      prompt:      request.prompt,
      context:     request.context,
      pageContext: request.pageContext  || { title: '', description: '' },
      chatHistory: request.chatHistory || [],
    })
      .then(reply => sendResponse({ reply }))
      .catch(err  => sendResponse({ error: err.message }));
    return true; // keep channel open for async
  }
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
 */
async function handleAIRequest({ prompt, context, pageContext, chatHistory }) {
  const data = await chrome.storage.local.get(['provider', 'model', 'apiKey']);
  const provider = data.provider || 'ollama';
  const model    = data.model    || 'qwen2.5:3b';
  const apiKey   = data.apiKey;

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
      // Sanitise: only allow 'user' or 'assistant' roles
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

  // ── Dispatch ────────────────────────────────────────────────
  if (provider === 'ollama')  return fetchOllama(messages, model);
  if (provider === 'openai')  return fetchOpenAI(messages, model, apiKey);
  if (provider === 'gemini')  return fetchGemini(messages, model, apiKey);
  if (provider === 'groq')    return fetchGroq(messages, model, apiKey);
  throw new Error('Invalid provider selected.');
}

/**
 * Ollama — collapse the messages array into a single prompt string
 * because the /api/generate endpoint is single-turn.
 * Use /api/chat for multi-turn if your Ollama version supports it.
 */
async function fetchOllama(messages, model) {
  // Flatten to a readable prompt so older Ollama builds work too
  const prompt = messages
    .filter(m => m.role !== 'system' || messages.indexOf(m) === 0)
    .map(m => {
      if (m.role === 'system')    return `[System]: ${m.content}`;
      if (m.role === 'user')      return `User: ${m.content}`;
      if (m.role === 'assistant') return `Assistant: ${m.content}`;
      return m.content;
    })
    .join('\n\n');

  const res = await fetch('http://localhost:11434/api/generate', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model, prompt, stream: false }),
  });
  if (!res.ok) throw new Error('Failed to connect to local Ollama.');
  const data = await res.json();
  return data.response;
}

async function fetchOpenAI(messages, model, apiKey) {
  if (!apiKey) throw new Error('API Key missing.');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body:    JSON.stringify({ model, messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function fetchGemini(messages, model, apiKey) {
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
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contents }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates[0].content.parts[0].text;
}

async function fetchGroq(messages, model, apiKey) {
  if (!apiKey) throw new Error('API Key missing.');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body:    JSON.stringify({ model, messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}