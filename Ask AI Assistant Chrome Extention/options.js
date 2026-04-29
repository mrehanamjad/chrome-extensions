document.addEventListener('DOMContentLoaded', () => {
  const provider = document.getElementById('provider');
  const model = document.getElementById('model');
  const apiKey = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const status = document.getElementById('status');

  // Load saved settings
  chrome.storage.local.get(['provider', 'model', 'apiKey'], (result) => {
    provider.value = result.provider || 'ollama';
    model.value = result.model || 'llama3';
    apiKey.value = result.apiKey || '';
  });

  // Save settings
  saveBtn.addEventListener('click', () => {
    chrome.storage.local.set({
      provider: provider.value,
      model: model.value,
      apiKey: apiKey.value
    }, () => {
      status.style.display = 'block';
      setTimeout(() => status.style.display = 'none', 2000);
    });
  });
});