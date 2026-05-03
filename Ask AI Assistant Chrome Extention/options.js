// ─────────────────────────────────────────────────────────────
//  Ask AI Assistant — Options Page
// ─────────────────────────────────────────────────────────────

// ── Curated model lists per provider ─────────────────────────
const PROVIDER_MODELS = {
  openai: [
    { value: 'gpt-4o',             label: 'GPT-4o (Best quality)' },
    { value: 'gpt-4o-mini',        label: 'GPT-4o Mini (Fast & cheap)' },
    { value: 'gpt-4-turbo',        label: 'GPT-4 Turbo (Legacy powerful)' },
    { value: 'gpt-3.5-turbo',      label: 'GPT-3.5 Turbo (Legacy fast)' },
    { value: '__custom__',         label: '── Add Custom Model…' },
  ],
  gemini: [
    { value: 'gemini-3-flash',          label: 'Gemini 3 Flash (Lightning speed)' },
    { value: 'gemini-3-pro',            label: 'Gemini 3 Pro (Deep reasoning)' },
    { value: 'gemini-2.5-flash',        label: 'Gemini 2.5 Flash (Balanced)' },
    { value: 'gemini-2.5-pro',          label: 'Gemini 2.5 Pro (Heavy math/code)' },
    { value: '__custom__',              label: '── Add Custom Model…' },
  ],
  groq: [
    { value: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B (Instant responses)' },
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Smart & versatile)' },
    { value: 'openai/gpt-oss-120b',     label: 'GPT-OSS 120B (High intelligence)' },
    { value: 'openai/gpt-oss-20b',      label: 'GPT-OSS 20B (Ultra-low latency)' },
    { value: 'qwen/qwen3-32b',          label: 'Qwen 3 32B (Advanced coding)' },
    { value: '__custom__',              label: '── Add Custom Model…' },
  ],
  openrouter: [
    {value: 'google/gemma-4-31b-it:free',            label: 'Gemma 4 31B (Fast)'},
    {value: 'openai/gpt-oss-120b:free', label: 'GPT-OSS 120B'},
    {value: 'openai/gpt-oss-20b:free', label: 'GPT-OSS 20B'},
    {value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B '},
    {value: 'qwen/qwen3-next-80b-a3b-instruct:free', label: 'Qwen 3 Next 80B'},

    { value: '__custom__',                           label: '── Add Custom Model…' },
  ],
};

document.addEventListener('DOMContentLoaded', () => {
  // ── Element refs ────────────────────────────────────────────
  const providerEl      = document.getElementById('provider');
  const modelText       = document.getElementById('model-text');
  const modelSelectWrap = document.getElementById('model-select-wrapper');
  const modelSelect     = document.getElementById('model-select');
  const modelCustomWrap = document.getElementById('model-custom-wrapper');
  const modelCustom     = document.getElementById('model-custom');
  const apiKeyField     = document.getElementById('apikey-field');
  const apiKeyEl        = document.getElementById('apiKey');
  const saveBtn         = document.getElementById('saveBtn');
  const statusEl        = document.getElementById('status');

  // ── Populate the model <select> for a given provider ───────
  function populateModelSelect(provider, savedModel) {
    const models = PROVIDER_MODELS[provider] || [];
    modelSelect.innerHTML = '';

    let matchedOption = false;

    models.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      modelSelect.appendChild(opt);

      // If the saved model matches a known option, pre-select it
      if (value === savedModel) matchedOption = true;
    });

    if (savedModel && !matchedOption && savedModel !== '__custom__') {
      // The saved model is a custom string not in the list
      modelSelect.value = '__custom__';
      modelCustom.value = savedModel;
      modelCustomWrap.style.display = 'block';
    } else if (savedModel && matchedOption) {
      modelSelect.value = savedModel;
      modelCustomWrap.style.display = 'none';
    } else {
      // Default: select first non-custom option
      const firstReal = models.find(m => m.value !== '__custom__');
      if (firstReal) modelSelect.value = firstReal.value;
      modelCustomWrap.style.display = 'none';
    }
  }

  // ── Switch the UI to match the chosen provider ─────────────
  function applyProvider(provider, savedModel) {
    const isOllama = provider === 'ollama';

    // Model input type
    if (isOllama) {
      modelText.style.display       = 'block';
      modelSelectWrap.style.display = 'none';
      modelCustomWrap.style.display = 'none';
      modelText.value = savedModel || 'llama3.2:3b';
    } else {
      modelText.style.display       = 'none';
      modelSelectWrap.style.display = 'block';
      populateModelSelect(provider, savedModel);
    }

    // API key visibility
    if (isOllama) {
      apiKeyField.classList.remove('visible');
    } else {
      apiKeyField.classList.add('visible');
    }
  }

  // ── Read the effective model value from whichever input is active ──
  function getModelValue() {
    const provider = providerEl.value;
    if (provider === 'ollama') {
      return modelText.value.trim();
    }
    if (modelSelect.value === '__custom__') {
      return modelCustom.value.trim();
    }
    return modelSelect.value;
  }

  // ── Load saved settings ─────────────────────────────────────
  chrome.storage.local.get(['provider', 'model', 'apiKey'], (result) => {
    const savedProvider = result.provider || 'ollama';
    const savedModel    = result.model    || '';
    const savedApiKey   = result.apiKey   || '';

    providerEl.value = savedProvider;
    apiKeyEl.value   = savedApiKey;

    applyProvider(savedProvider, savedModel);
  });

  // ── Provider change ─────────────────────────────────────────
  providerEl.addEventListener('change', () => {
    applyProvider(providerEl.value, '');
  });

  // ── Model dropdown change ───────────────────────────────────
  modelSelect.addEventListener('change', () => {
    if (modelSelect.value === '__custom__') {
      modelCustomWrap.style.display = 'block';
      modelCustom.focus();
    } else {
      modelCustomWrap.style.display = 'none';
      modelCustom.value = '';
    }
  });

  // ── Save ────────────────────────────────────────────────────
  saveBtn.addEventListener('click', () => {
    const modelValue = getModelValue();

    if (!modelValue) {
      modelText.style.borderColor   = '#ef4444';
      modelCustom.style.borderColor = '#ef4444';
      setTimeout(() => {
        modelText.style.borderColor   = '';
        modelCustom.style.borderColor = '';
      }, 1800);
      return;
    }

    chrome.storage.local.set({
      provider: providerEl.value,
      model:    modelValue,
      apiKey:   apiKeyEl.value.trim(),
    }, () => {
      statusEl.style.display = 'block';
      setTimeout(() => { statusEl.style.display = 'none'; }, 2500);
    });
  });
});