// ─────────────────────────────────────────────────────────────
//  AI Assistant Chrome Extension — content.js
//  Libraries available as globals (loaded before this script):
//    • marked  (markdown → HTML)
//    • hljs    (syntax highlighting)
// ─────────────────────────────────────────────────────────────

// ── Configure marked ────────────────────────────────────────
marked.setOptions({
  breaks: true,        // line breaks become <br>
  gfm: true,           // GitHub Flavoured Markdown
  headerIds: false,    // no id= attrs on headings (cleaner DOM)
  mangle: false,
});

// Custom renderer — wraps every code block in a container that
// includes a language badge and a "Copy" button.
const renderer = new marked.Renderer();

renderer.code = function (code, language) {
  // hljs may pass an object instead of a plain string in newer versions
  if (typeof code === 'object' && code !== null) {
    language = code.lang || language || '';
    code = code.text || '';
  }

  const validLang = (language && hljs.getLanguage(language)) ? language : null;
  const highlighted = validLang
    ? hljs.highlight(code, { language: validLang }).value
    : hljs.highlightAuto(code).value;

  const langLabel = validLang ? validLang : 'code';

  return `
<div class="ai-code-block">
  <div class="ai-code-header">
    <span class="ai-code-lang">${langLabel}</span>
    <button class="ai-copy-code-btn" title="Copy code">Copy</button>
  </div>
  <pre><code class="hljs language-${langLabel}">${highlighted}</code></pre>
</div>`;
};

marked.use({ renderer });

// ── Page Meta-Context ────────────────────────────────────────
/**
 * Extracts lightweight page-level context so the AI knows
 * which page it is assisting on.
 * @returns {{ title: string, description: string }}
 */
function getPageContext() {
  const title = document.title || '';
  const metaDesc = document.querySelector('meta[name="description"]');
  const description = metaDesc ? (metaDesc.getAttribute('content') || '') : '';
  return { title, description };
}

// ── Session History (sliding window) ─────────────────────────
// Holds the last N messages for the current popup session so
// the AI can maintain conversational context.
// Format: [{ role: 'user'|'assistant', content: string }, ...]
const SESSION_WINDOW = 4; // keep last 4 messages (2 turns)
let sessionHistory = [];

/**
 * Push a message into sessionHistory and trim to the window size.
 * @param {'user'|'assistant'} role
 * @param {string} content
 */
function pushSession(role, content) {
  sessionHistory.push({ role, content });
  if (sessionHistory.length > SESSION_WINDOW) {
    sessionHistory.splice(0, sessionHistory.length - SESSION_WINDOW);
  }
}

// ── 1. Inject UI Elements ────────────────────────────────────
// Floating inline toolbar (replaces the single FAB button)
const toolbar = document.createElement('div');
toolbar.id = 'ask-ai-floating-toolbar';
toolbar.innerHTML = `
  <button id="ask-ai-fab" class="ai-toolbar-primary">✨ Ask AI</button>
  <span class="ai-toolbar-divider"></span>
  <button class="ai-toolbar-action" data-prompt="Please explain the highlighted text in simple, everyday language.">Explain</button>
  <button class="ai-toolbar-action" data-prompt="Please summarize the highlighted text concisely.">Summarize</button>
  <button class="ai-toolbar-action" data-prompt="Please fix any grammar or spelling mistakes in this text and improve the flow.">Fix Grammar</button>
`;
document.body.appendChild(toolbar);

// Keep a reference to the primary button for compatibility
const fab = document.getElementById('ask-ai-fab');

const popup = document.createElement('div');
popup.id = 'ask-ai-popup';
popup.innerHTML = `
  <div id="ask-ai-header">
    <span>Ask AI Assistant</span>
    <div class="header-actions">
      <button id="ask-ai-clear" title="Clear chat history">Clear</button>
      <button id="btn-dark">🌓</button>
      <span id="ask-ai-settings" title="Settings">⚙️</span>
      <span id="ask-ai-close" title="Close">&times;</span>
    </div>
  </div>
  <div id="ask-ai-chat"></div>
  <div id="ask-ai-controls">
    <div class="ai-quick-actions">
      <button id="btn-summarize">Summarize</button>
      <button id="btn-eli5">Explain Simply</button>
      <button id="btn-fix-grammar">Fix Grammar</button>
    </div>
    <div id="ask-ai-input-wrapper">
      <input type="text" id="ask-ai-input" placeholder="Ask a question..." />
      <button id="ask-ai-send">Send</button>
    </div>
  </div>
`;
document.body.appendChild(popup);

let currentSelection = '';

// ── 2. Persistence Helpers ────────────────────────────────────
// Use the page URL (without hash) as the storage key so every
// page gets its own independent conversation.
const STORAGE_KEY = 'ai_chat_' + window.location.href.split('#')[0];

// In-memory mirror of what is in storage for this URL.
// Each entry: { sender: 'user'|'ai', text: string }
let chatHistory = [];

/** Persist the current in-memory history to chrome.storage.local. */
function saveHistory() {
  chrome.storage.local.set({ [STORAGE_KEY]: chatHistory });
}

/** Load stored history and replay every message into the UI.
 *  Before replaying, checks that the user has configured a provider
 *  and model. If not, renders the first-run empty state instead.
 */
function loadHistory(callback) {
  chrome.storage.local.get(['provider', 'model', 'apiKey', STORAGE_KEY], (result) => {
    const provider = result.provider || 'ollama';
    const model    = result.model    || '';
    const apiKey   = result.apiKey   || '';

    // Cloud providers require an API key; Ollama just needs a model name.
    const needsApiKey = (provider !== 'ollama');
    const isConfigured = model.trim() !== '' && (!needsApiKey || apiKey.trim() !== '');

    if (!isConfigured) {
      // ── Render the first-run / empty state ──────────────────
      chatArea.innerHTML = '';  // clear any stale content

      const emptyState = document.createElement('div');
      emptyState.id = 'ai-empty-state';
      emptyState.innerHTML = `
        <div class="ai-empty-icon">✨</div>
        <h3 class="ai-empty-title">Welcome to Ask AI</h3>
        <p class="ai-empty-desc">
          Configure your AI model to start chatting.<br>
          Highlight any text on the page, then ask questions about it.
        </p>
        <button id="ai-empty-configure-btn">Configure Now</button>
        <p class="ai-empty-hint">Supports Ollama, OpenAI, Gemini &amp; Groq</p>
      `;
      chatArea.appendChild(emptyState);

      document.getElementById('ai-empty-configure-btn').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'openSettings' });
      });

      // Do NOT call callback — don't auto-send until configured.
      return;
    }

    // ── Configured: replay persisted history ─────────────────
    const saved = result[STORAGE_KEY];
    if (Array.isArray(saved) && saved.length > 0) {
      chatHistory = saved;
      saved.forEach(({ sender, text }) => renderMessage(sender, text));
    }
    if (callback) callback();
  });
}

/** Wipe the history for the current URL from storage and the UI. */
function clearHistory() {
  chatHistory = [];
  chrome.storage.local.remove(STORAGE_KEY, () => {
    chatArea.innerHTML = '';
  });
}

// ── 3. Text Selection Detection ──────────────────────────────
document.addEventListener('mouseup', (e) => {
  if (popup.contains(e.target) || toolbar.contains(e.target)) return;

  const selection = window.getSelection().toString().trim();
  if (selection.length > 0) {
    currentSelection = selection;
    toolbar.style.display = 'flex';
    // Position toolbar just below and to the right of the cursor
    toolbar.style.top  = `${e.pageY + 12}px`;
    toolbar.style.left = `${e.pageX + 8}px`;
  } else {
    toolbar.style.display = 'none';
  }
});

document.addEventListener('mousedown', (e) => {
  if (!toolbar.contains(e.target) && !popup.contains(e.target)) {
    toolbar.style.display = 'none';
  }
});

// ── 4. Chat Logic ────────────────────────────────────────────
const chatArea   = document.getElementById('ask-ai-chat');
const inputField = document.getElementById('ask-ai-input');

/**
 * Attach copy-code button handlers and syntax-highlight inline code
 * inside an already-rendered AI message bubble.
 * Called after every render update so newly injected buttons work.
 * @param {HTMLElement} msgDiv
 */
function attachCodeHandlers(msgDiv) {
  msgDiv.querySelectorAll('.ai-copy-code-btn').forEach((btn) => {
    // Avoid double-attaching listeners
    if (btn.dataset.listenerAttached) return;
    btn.dataset.listenerAttached = 'true';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const codeEl = btn.closest('.ai-code-block').querySelector('code');
      navigator.clipboard.writeText(codeEl.innerText).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      });
    });
  });

  msgDiv.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
    hljs.highlightElement(block);
  });
}

/**
 * Render a single message bubble into the DOM.
 * This is the pure DOM function — it does NOT touch storage.
 *
 * @param {'user'|'ai'} sender
 * @param {string} text — plain text for user msgs, markdown for AI.
 * @returns {HTMLElement} the created bubble element
 */
function renderMessage(sender, text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = sender === 'user' ? 'user-msg' : 'ai-msg';

  if (sender === 'ai') {
    msgDiv.innerHTML = marked.parse(text);
    attachCodeHandlers(msgDiv);
  } else {
    // User messages: plain text only (no HTML injection risk)
    msgDiv.textContent = text;
  }

  chatArea.appendChild(msgDiv);
  chatArea.scrollTop = chatArea.scrollHeight;
  return msgDiv;
}

/**
 * Append a message, persist it, and render it.
 *
 * @param {'user'|'ai'} sender
 * @param {string} text
 */
function appendMessage(sender, text) {
  chatHistory.push({ sender, text });
  saveHistory();
  renderMessage(sender, text);
}

function handleSend(promptOverride = null) {
  const userText = promptOverride || inputField.value.trim();
  if (!userText && !currentSelection) return;

  inputField.value = '';
  appendMessage('user', userText || 'Analyze selection');

  // Push the user turn into the sliding window BEFORE sending
  pushSession('user', userText || 'Analyze selection');

  // ── Open a long-lived port for streaming ──────────────────
  const port = chrome.runtime.connect({ name: 'ai-stream' });

  // Create the AI bubble immediately (empty) and remove the loading dots
  const aiBubble = document.createElement('div');
  aiBubble.className = 'ai-msg';
  chatArea.appendChild(aiBubble);
  chatArea.scrollTop = chatArea.scrollHeight;

  // Show a blinking cursor while we wait for the first chunk
  aiBubble.innerHTML = '<span class="ai-stream-cursor"></span>';

  let accumulated = '';  // full response text built up chunk by chunk
  let streamStarted = false;

  port.onMessage.addListener((msg) => {
    if (msg.error) {
      aiBubble.innerHTML = marked.parse(`**Error:** ${msg.error}`);
      // Persist error message
      chatHistory.push({ sender: 'ai', text: `**Error:** ${msg.error}` });
      saveHistory();
      port.disconnect();
      return;
    }

    if (msg.chunk) {
      if (!streamStarted) {
        streamStarted = true;
        aiBubble.innerHTML = ''; // remove the cursor placeholder
      }
      accumulated += msg.chunk;
      // Live-render the accumulated markdown as chunks arrive
      aiBubble.innerHTML = marked.parse(accumulated);
      attachCodeHandlers(aiBubble);
      chatArea.scrollTop = chatArea.scrollHeight;
    }

    if (msg.done) {
      // Final render pass — ensures the last partial chunk is clean
      aiBubble.innerHTML = marked.parse(accumulated);
      attachCodeHandlers(aiBubble);
      chatArea.scrollTop = chatArea.scrollHeight;

      // Persist the complete AI reply
      chatHistory.push({ sender: 'ai', text: accumulated });
      saveHistory();

      // Push into session sliding window for multi-turn context
      pushSession('assistant', accumulated);

      port.disconnect();
    }
  });

  // Send the enriched payload through the port
  port.postMessage({
    action:      'askAI',
    prompt:      userText,
    context:     currentSelection,
    pageContext: getPageContext(),
    // Send a copy of the window EXCLUDING the message we just added
    // so background.js can prepend it as prior conversation
    chatHistory: sessionHistory.slice(0, -1),
  });
}

// ── 5. Event Listeners ───────────────────────────────────────

let historyLoaded = false;

/**
 * Shared helper: hide toolbar, show popup, load history on
 * first open, then run an optional callback once ready.
 */
function triggerPopupAction(promptToAutoSend = null) {
  toolbar.style.display = 'none';
  popup.style.display = 'flex';

  const proceed = () => {
    // 1. Print the context block to the UI
    if (currentSelection) {
      appendMessage('ai', `**Context captured:**\n\n> ${currentSelection.substring(0, 120)}${currentSelection.length > 120 ? '…' : ''}`);
    }
    
    // 2. Auto-send the user's prompt if a quick-action was clicked
    if (promptToAutoSend) {
      handleSend(promptToAutoSend);
    }
  };

  if (!historyLoaded) {
    historyLoaded = true;
    loadHistory(proceed);
  } else {
    proceed();
  }
}

// Primary "✨ Ask AI" button — open popup, print context, wait for user input
fab.addEventListener('click', () => {
  triggerPopupAction();
});

// Quick-action toolbar buttons — open popup, print context, and auto-send prompt
toolbar.querySelectorAll('.ai-toolbar-action').forEach((btn) => {
  btn.addEventListener('click', () => {
    triggerPopupAction(btn.dataset.prompt);
  });
});

document.getElementById('ask-ai-close').addEventListener('click', () => {
  popup.style.display = 'none';
  // Reset so the config check re-runs on next open.
  // This ensures the empty state disappears after the user configures a model.
  historyLoaded = false;
});


document.getElementById('ask-ai-send').addEventListener('click', () => handleSend());
inputField.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleSend();
});

document.getElementById('btn-summarize').addEventListener('click', () =>
  handleSend('Please summarize the highlighted text.')
);
document.getElementById('btn-eli5').addEventListener('click', () =>
  handleSend('Explain the highlighted text in simple, everyday language.')
);
document.getElementById('btn-fix-grammar').addEventListener('click', () =>
  handleSend('Please fix any grammar or spelling mistakes in this text and improve the flow.')
);


// 1. Load the saved theme when the script runs
chrome.storage.local.get(['theme'], (result) => {
  if (result.theme === 'dark') {
    popup.classList.add('dark-mode');
  }
});

// 2. Update the button to save the theme when clicked
document.getElementById('btn-dark').addEventListener('click', () => {
  // Toggle the class and check if it's currently active
  const isDark = popup.classList.toggle('dark-mode');
  
  // Save the new state to storage
  chrome.storage.local.set({ theme: isDark ? 'dark' : 'light' });
});

document.getElementById('ask-ai-settings').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'openSettings' });
});

// Clear Chat button
document.getElementById('ask-ai-clear').addEventListener('click', () => {
  if (confirm('Clear the conversation history for this page?')) {
    clearHistory();
  }
});

// ── 6. Dragging Logic ────────────────────────────────────────
const header = document.getElementById('ask-ai-header');
let isDragging = false, startX, startY, initialX, initialY;

header.addEventListener('mousedown', (e) => {
  // Don't drag if user clicked any interactive header element
  if (e.target.closest('#ask-ai-clear, #ask-ai-close, #ask-ai-settings, #btn-dark')) return;
  isDragging = true;
  startX = e.clientX; startY = e.clientY;
  initialX = popup.offsetLeft; initialY = popup.offsetTop;
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  popup.style.left  = `${initialX + (e.clientX - startX)}px`;
  popup.style.top   = `${initialY + (e.clientY - startY)}px`;
  popup.style.right = 'auto';
});

document.addEventListener('mouseup', () => { isDragging = false; });