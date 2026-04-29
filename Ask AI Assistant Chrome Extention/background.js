// Update the listener at the top of background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "openSettings") {
    // This securely opens options.html in a new tab
    chrome.runtime.openOptionsPage();
    sendResponse({ status: "opening" });
    return true; 
  }

  if (request.action === "askAI") {
    handleAIRequest(request.context, request.prompt)
      .then(reply => sendResponse({ reply }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // Keep message channel open for async
  }
});

async function handleAIRequest(context, userPrompt) {
  const data = await chrome.storage.local.get(['provider', 'model', 'apiKey']);
  const provider = data.provider || 'ollama';
  const model = data.model || 'qwen2.5:3b';
  const apiKey = data.apiKey;

  const systemPrompt = `Use the following highlighted text as context when answering. Context: "${context}"`;
  const finalPrompt = context ? `${systemPrompt}\n\nUser Question: ${userPrompt}` : userPrompt;

  if (provider === 'ollama') {
    return fetchOllama(finalPrompt, model);
  } else if (provider === 'openai') {
    return fetchOpenAI(finalPrompt, model, apiKey);
  } else if (provider === 'gemini') {
    return fetchGemini(finalPrompt, model, apiKey);
  } else if (provider === 'groq') {
    return fetchGroq(finalPrompt, model, apiKey);
  }
  throw new Error("Invalid provider selected.");
}

async function fetchOllama(prompt, model) {
  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model, prompt: prompt, stream: false })
  });
  if (!res.ok) throw new Error("Failed to connect to local Ollama.");
  const data = await res.json();
  return data.response;
}

async function fetchOpenAI(prompt, model, apiKey) {
  if (!apiKey) throw new Error("API Key missing.");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model, messages: [{ role: "user", content: prompt }] })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function fetchGemini(prompt, model, apiKey) {
  if (!apiKey) throw new Error("API Key missing.");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates[0].content.parts[0].text;
}

async function fetchGroq(prompt, model, apiKey) {
  if (!apiKey) throw new Error("API Key missing.");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model, messages: [{ role: "user", content: prompt }] })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}