document.addEventListener('DOMContentLoaded', () => {
  const openAppBtn = document.getElementById('openAppBtn');
  const switchAccBtn = document.getElementById('switchAccBtn');

  openAppBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://localhost:3000' });
  });

  const STORAGE_KEY = 'jitsi_ai_plugin_accounts';
  const STORAGE_AI_KEY = 'jitsi_plugin_gemini_key';

  let accounts = [
    { id: 'acc_1', name: 'Account 1 (Primary Drive)', clientId: 'your.name@gmail.com', freeGb: 14.2 },
    { id: 'acc_2', name: 'Account 2 (Backup Drive)', clientId: 'backup.drive@gmail.com', freeGb: 14.8 }
  ];

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) accounts = JSON.parse(saved);
  } catch (e) {}

  let activeIdx = 0;

  function refreshDisplay() {
    const cur = accounts[activeIdx];
    document.getElementById('popAccount').textContent = `Account ${activeIdx + 1}`;
    document.getElementById('popEmail').textContent = cur.clientId || 'Not set';
    document.getElementById('popFree').textContent = `${cur.freeGb || 15} GB free`;
    document.getElementById('popupEmailInput').value = cur.clientId || '';
  }

  refreshDisplay();

  // ----------------------------------------------------
  // Gemini API Key Management in Popup
  // ----------------------------------------------------
  const geminiInput = document.getElementById('popupGeminiKeyInput');
  const saveGeminiBtn = document.getElementById('savePopupGeminiBtn');
  const keyStatus = document.getElementById('popupKeyStatus');

  function setKeyStatus(saved) {
    if (keyStatus) {
      keyStatus.style.display = saved ? 'block' : 'none';
      keyStatus.textContent = saved ? '✓ Key configured & saved across browser' : '';
    }
  }

  function loadGeminiKey() {
    // 1. Try local storage
    let key = '';
    try { key = localStorage.getItem(STORAGE_AI_KEY) || ''; } catch (e) {}
    if (key) {
      geminiInput.value = key;
      setKeyStatus(true);
    }

    // 2. Try chrome.storage (sync / local)
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const area = chrome.storage.sync || chrome.storage.local;
        if (area) {
          area.get([STORAGE_AI_KEY], (res) => {
            if (chrome.runtime.lastError || !res) return;
            if (res[STORAGE_AI_KEY]) {
              geminiInput.value = res[STORAGE_AI_KEY];
              try { localStorage.setItem(STORAGE_AI_KEY, res[STORAGE_AI_KEY]); } catch (e) {}
              setKeyStatus(true);
            }
          });
        }
      }
    } catch (e) {}
  }

  function saveGeminiKey(notify = true) {
    const val = (geminiInput.value || '').trim();
    try { localStorage.setItem(STORAGE_AI_KEY, val); } catch (e) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        if (chrome.storage.sync) chrome.storage.sync.set({ [STORAGE_AI_KEY]: val });
        if (chrome.storage.local) chrome.storage.local.set({ [STORAGE_AI_KEY]: val });
      }
    } catch (e) {}

    setKeyStatus(Boolean(val));
    if (notify) {
      alert(val ? '✅ Gemini API Key saved! Ready for all Jitsi calls.' : 'Cleared Gemini API key');
    }
  }

  loadGeminiKey();

  if (saveGeminiBtn) {
    saveGeminiBtn.addEventListener('click', () => saveGeminiKey(true));
  }

  // Auto-save on typing or paste without needing to click Save
  if (geminiInput) {
    geminiInput.addEventListener('change', () => saveGeminiKey(false));
    geminiInput.addEventListener('paste', () => setTimeout(() => saveGeminiKey(false), 50));
  }

  // ----------------------------------------------------
  // Drive Email Management in Popup
  // ----------------------------------------------------
  const saveBtn = document.getElementById('savePopupEmailBtn');
  saveBtn.addEventListener('click', () => {
    const newEmail = document.getElementById('popupEmailInput').value.trim();
    if (!newEmail) {
      alert('Please enter your email address');
      return;
    }
    accounts[activeIdx].clientId = newEmail;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
      if (typeof chrome !== 'undefined' && chrome.storage) {
        if (chrome.storage.sync) chrome.storage.sync.set({ [STORAGE_KEY]: JSON.stringify(accounts) });
        if (chrome.storage.local) chrome.storage.local.set({ [STORAGE_KEY]: JSON.stringify(accounts) });
      }
    } catch (e) {}
    refreshDisplay();
    alert(`✅ Saved! Target email set to: ${newEmail}`);
  });

  switchAccBtn.addEventListener('click', () => {
    activeIdx = activeIdx === 0 ? 1 : 0;
    refreshDisplay();
  });
});

