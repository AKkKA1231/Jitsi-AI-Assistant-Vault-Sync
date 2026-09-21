document.addEventListener('DOMContentLoaded', () => {
  const openAppBtn = document.getElementById('openAppBtn');
  const switchAccBtn = document.getElementById('switchAccBtn');

  openAppBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://localhost:3000' });
  });

  const STORAGE_KEY = 'jitsi_ai_plugin_accounts';
  const STORAGE_AI_KEY = 'jitsi_plugin_gemini_key';

  let accounts = [
    { id: 'acc_1', name: 'Account 1 (Primary Drive)', clientId: '', freeGb: null },
    { id: 'acc_2', name: 'Account 2 (Backup Drive)', clientId: '', freeGb: null }
  ];

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        accounts = parsed.map(a => {
          const item = { ...a };
          if (item.clientId === 'your.name@gmail.com' || item.clientId === 'backup.drive@gmail.com') {
            item.clientId = '';
          }
          return item;
        });
      }
    }
  } catch (e) {}

  let activeIdx = 0;

  function refreshDisplay() {
    const cur = accounts[activeIdx] || { clientId: '', freeGb: null };
    document.getElementById('popAccount').textContent = `Account ${activeIdx + 1}`;
    document.getElementById('popEmail').textContent = (cur.clientId && cur.clientId !== 'your.name@gmail.com') ? cur.clientId : 'Not configured';
    document.getElementById('popFree').textContent = cur.freeGb ? `${cur.freeGb} GB free` : '--';
    document.getElementById('popupEmailInput').value = (cur.clientId && cur.clientId !== 'your.name@gmail.com') ? cur.clientId : '';
  }

  refreshDisplay();

  // ----------------------------------------------------
  // Gemini API Key Management in Popup
  // ----------------------------------------------------
  const geminiInput = document.getElementById('popupGeminiKeyInput');
  const saveGeminiBtn = document.getElementById('savePopupGeminiBtn');
  const testGeminiBtn = document.getElementById('testPopupGeminiBtn');
  const keyStatus = document.getElementById('popupKeyStatus');
  const sttModeEl = document.getElementById('popSttMode');

  function updateSttIndicator(hasKey) {
    if (sttModeEl) {
      if (hasKey) {
        sttModeEl.textContent = 'Gemini Flash (Active)';
        sttModeEl.style.color = '#34d399';
      } else {
        sttModeEl.textContent = 'Web Speech (Fallback)';
        sttModeEl.style.color = '#fbbf24';
      }
    }
  }

  function setKeyStatus(saved, msg = '') {
    if (keyStatus) {
      keyStatus.style.display = saved ? 'block' : 'none';
      keyStatus.textContent = msg || (saved ? '✓ Key configured & saved across browser' : '');
      keyStatus.style.color = '#34d399';
    }
    updateSttIndicator(Boolean(saved));
  }

  function loadGeminiKey() {
    // 1. Try local storage
    let key = '';
    try { key = localStorage.getItem(STORAGE_AI_KEY) || ''; } catch (e) {}
    if (key) {
      geminiInput.value = key;
      setKeyStatus(true);
    } else {
      updateSttIndicator(false);
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
    let val = (geminiInput.value || '').trim();
    val = val.replace(/^["'`\s]+|["'`\s]+$/g, '');
    geminiInput.value = val;

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

  if (testGeminiBtn) {
    testGeminiBtn.addEventListener('click', () => {
      let val = (geminiInput.value || '').trim();
      val = val.replace(/^["'`\s]+|["'`\s]+$/g, '');
      if (!val) {
        alert('Please paste a Gemini API Key first.\nYou can get one free at aistudio.google.com/app/apikey');
        return;
      }
      saveGeminiKey(false);
      testGeminiBtn.disabled = true;
      testGeminiBtn.textContent = '...';
      if (keyStatus) {
        keyStatus.style.display = 'block';
        keyStatus.style.color = '#818cf8';
        keyStatus.textContent = '⏳ Testing connection to Gemini AI endpoint...';
      }

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'GEMINI_TEST_KEY', type: 'GEMINI_TEST_KEY', apiKey: val }, (resp) => {
          testGeminiBtn.disabled = false;
          testGeminiBtn.textContent = 'Test';
          if (chrome.runtime.lastError || !resp || !resp.success) {
            const err = resp?.error || chrome.runtime.lastError?.message || 'Connection failed';
            if (keyStatus) {
              keyStatus.style.display = 'block';
              keyStatus.style.color = '#f87171';
              keyStatus.textContent = `❌ Test failed: ${err}`;
            }
            alert(`❌ Gemini API Key Test Failed:\n${err}`);
          } else {
            const connectedModel = resp.model || resp.data?.modelUsed || 'gemini-3.1-flash-lite';
            setKeyStatus(true, `✅ Connected: ${connectedModel} (Free Tier)`);
            alert(`✅ Gemini API Key is Valid!\nModel Connected: ${connectedModel}\nFree tier active & ready for Jitsi recordings.`);
          }
        });
      } else {
        testGeminiBtn.disabled = false;
        testGeminiBtn.textContent = 'Test';
        alert('Chrome runtime not available');
      }
    });
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

  const resetPopupBtn = document.getElementById('resetPopupBtn');
  if (resetPopupBtn) {
    resetPopupBtn.addEventListener('click', () => {
      if (!confirm('Clear all stored credentials (API key, email, Drive settings) and reset?')) {
        return;
      }
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_AI_KEY);
        if (typeof chrome !== 'undefined' && chrome.storage) {
          if (chrome.storage.local) chrome.storage.local.clear();
          if (chrome.storage.sync) chrome.storage.sync.clear();
        }
      } catch (e) {}
      accounts = [
        { id: 'acc_1', name: 'Account 1 (Primary Drive)', clientId: '', freeGb: null },
        { id: 'acc_2', name: 'Account 2 (Backup Drive)', clientId: '', freeGb: null }
      ];
      if (geminiInput) geminiInput.value = '';
      setKeyStatus(false);
      updateSttIndicator(false);
      refreshDisplay();
      alert('🗑️ Extension storage & cached credentials wiped clean!');
    });
  }
});

