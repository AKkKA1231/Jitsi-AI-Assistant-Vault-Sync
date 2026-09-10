document.addEventListener('DOMContentLoaded', () => {
  const openAppBtn = document.getElementById('openAppBtn');
  const switchAccBtn = document.getElementById('switchAccBtn');

  openAppBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://localhost:3000' });
  });

  const STORAGE_KEY = 'jitsi_ai_plugin_accounts';
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
    } catch (e) {}
    refreshDisplay();
    alert(`✅ Saved! Target email set to: ${newEmail}`);
  });

  switchAccBtn.addEventListener('click', () => {
    activeIdx = activeIdx === 0 ? 1 : 0;
    refreshDisplay();
  });
});
