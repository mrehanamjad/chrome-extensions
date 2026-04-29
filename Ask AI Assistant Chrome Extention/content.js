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

// ── 1. Inject UI Elements ────────────────────────────────────
const fab = document.createElement('button');
fab.id = 'ask-ai-fab';
fab.textContent = '✨ Ask AI';
document.body.appendChild(fab);

const popup = document.createElement('div');
popup.id = 'ask-ai-popup';
popup.innerHTML = `
  <div id="ask-ai-header">
    <span>Ask AI Assistant</span>
    <div class="header-actions">
      <button id="ask-ai-clear" title="Clear chat history">Clear</button>
      <span id="ask-ai-settings" title="Settings">⚙️</span>
      <span id="ask-ai-close" title="Close">&times;</span>
    </div>
  </div>
  <div id="ask-ai-chat"></div>
  <div id="ask-ai-controls">
    <div class="ai-quick-actions">
      <button id="btn-summarize">Summarize</button>
      <button id="btn-eli5">Explain Simply</button>
      <button id="btn-dark">🌓</button>
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

/** Load stored history and replay every message into the UI. */
function loadHistory(callback) {
  chrome.storage.local.get(STORAGE_KEY, (result) => {
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
  if (popup.contains(e.target) || e.target === fab) return;

  const selection = window.getSelection().toString().trim();
  if (selection.length > 0) {
    currentSelection = selection;
    fab.style.display = 'block';
    fab.style.top  = `${e.pageY + 10}px`;
    fab.style.left = `${e.pageX + 10}px`;
  } else {
    fab.style.display = 'none';
  }
});

document.addEventListener('mousedown', (e) => {
  if (e.target !== fab && !popup.contains(e.target)) {
    fab.style.display = 'none';
  }
});

// ── 4. Chat Logic ────────────────────────────────────────────
const chatArea   = document.getElementById('ask-ai-chat');
const inputField = document.getElementById('ask-ai-input');

/**
 * Render a single message bubble into the DOM.
 * This is the pure DOM function — it does NOT touch storage.
 *
 * @param {'user'|'ai'} sender
 * @param {string} text — plain text for user msgs, markdown for AI.
 */
function renderMessage(sender, text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = sender === 'user' ? 'user-msg' : 'ai-msg';

  if (sender === 'ai') {
    msgDiv.innerHTML = marked.parse(text);

    // Attach copy-code handlers
    msgDiv.querySelectorAll('.ai-copy-code-btn').forEach((btn) => {
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

    // Highlight any inline <code> that wasn't a fenced block
    msgDiv.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
      hljs.highlightElement(block);
    });

  } else {
    // User messages: plain text only (no HTML injection risk)
    msgDiv.textContent = text;
  }

  chatArea.appendChild(msgDiv);
  chatArea.scrollTop = chatArea.scrollHeight;
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

async function handleSend(promptOverride = null) {
  const userText = promptOverride || inputField.value.trim();
  if (!userText && !currentSelection) return;

  inputField.value = '';
  appendMessage('user', userText || 'Analyze selection');

  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'ai-msg ai-loading';
  loadingDiv.innerHTML = '<span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span>';
  chatArea.appendChild(loadingDiv);
  chatArea.scrollTop = chatArea.scrollHeight;

  chrome.runtime.sendMessage(
    { action: 'askAI', context: currentSelection, prompt: userText },
    (response) => {
      loadingDiv.remove();
      if (response.error) {
        appendMessage('ai', `**Error:** ${response.error}`);
      } else {
        appendMessage('ai', response.reply);
      }
    }
  );
}

// ── 5. Event Listeners ───────────────────────────────────────

// FAB: open popup and load history (only on first open)
let historyLoaded = false;

fab.addEventListener('click', () => {
  fab.style.display = 'none';
  popup.style.display = 'flex';

  if (!historyLoaded) {
    historyLoaded = true;
    loadHistory(() => {
      // After restoring history, add any fresh selection context
      if (currentSelection) {
        appendMessage('ai', `**Context captured:**\n\n> ${currentSelection.substring(0, 120)}${currentSelection.length > 120 ? '…' : ''}`);
      }
    });
  } else if (currentSelection) {
    appendMessage('ai', `**Context captured:**\n\n> ${currentSelection.substring(0, 120)}${currentSelection.length > 120 ? '…' : ''}`);
  }
});

document.getElementById('ask-ai-close').addEventListener('click', () => {
  popup.style.display = 'none';
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
document.getElementById('btn-dark').addEventListener('click', () =>
  popup.classList.toggle('dark-mode')
);

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
  if (e.target.closest('#ask-ai-clear, #ask-ai-close, #ask-ai-settings')) return;
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