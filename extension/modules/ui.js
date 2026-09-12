/**
 * Jitsi AI Assistant - UI Component & State Engine
 * Manages floating toggle pill, sidebar drawer, tab switching, audio stats, and responsive actions.
 */

(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  }
  if (typeof root !== 'undefined') {
    root.JitsiUI = mod;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function getEl(id) {
    return document.getElementById(id);
  }

  function escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = t || '';
    return d.innerHTML;
  }

  function showToast(msg, isError = false) {
    let toast = document.getElementById('jitsiAiToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'jitsiAiToast';
      toast.className = 'jitsi-ai-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.borderColor = isError ? '#ef4444' : '#10b981';
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 4500);
  }

  function switchTab(tabId) {
    const tabs = ['audio', 'notes', 'settings'];
    tabs.forEach(t => {
      const btn = getEl(`jitsiTabBtn_${t}`);
      const content = getEl(`jitsiTabContent_${t}`);
      if (btn) btn.classList.toggle('active', t === tabId);
      if (content) content.style.display = (t === tabId) ? 'block' : 'none';
    });
  }

  function setRecordButtonState(state) {
    const recBtn = getEl('jitsiToggleRecordBtn');
    if (!recBtn) return;

    if (state === 'recording') {
      recBtn.textContent = '⏹️ Stop & Prepare Notes';
      recBtn.classList.replace('jitsi-ai-ext-btn-primary', 'jitsi-ai-ext-btn-secondary');
      recBtn.style.display = 'inline-flex';
    } else if (state === 'ready') {
      recBtn.textContent = '🔴 Start Recording';
      recBtn.classList.replace('jitsi-ai-ext-btn-secondary', 'jitsi-ai-ext-btn-primary');
      recBtn.style.display = 'inline-flex';
    } else if (state === 'record_again') {
      recBtn.textContent = '🔴 Record Again';
      recBtn.classList.replace('jitsi-ai-ext-btn-secondary', 'jitsi-ai-ext-btn-primary');
      recBtn.style.display = 'inline-flex';
    }
  }

  function renderChunkItem(chunk) {
    const list = getEl('jitsiChunksList');
    if (!list) return;
    const placeholder = list.querySelector('em');
    if (placeholder) placeholder.remove();

    const item = document.createElement('div');
    item.style.cssText = 'background:rgba(30,41,59,0.7); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:6px 10px; font-size:11px; display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;';
    item.innerHTML = `
      <div>
        <span style="color:#818cf8; font-weight:700;">3-Min Block #${chunk.index}</span>
        <span style="color:#64748b; font-size:10px; margin-left:6px;">${chunk.timestamp}</span>
      </div>
      <span class="jitsi-ai-stats-pill">${chunk.sizeKb} KB (Voice Only)</span>
    `;
    list.prepend(item);

    const badge = getEl('jitsiChunkCountBadge');
    if (badge) badge.textContent = list.children.length;
  }

  function renderMeetingNotes(decList, actList, transcriptText) {
    const dBox = getEl('jitsiDecisionsBox');
    if (dBox) {
      dBox.innerHTML = (decList || []).map(d => `<div style="margin-bottom:6px; font-size:13px;">🔹 ${escapeHtml(d)}</div>`).join('');
    }

    const aBox = getEl('jitsiActionsBox');
    if (aBox) {
      aBox.innerHTML = (actList || []).map(a => `
        <div class="jitsi-ai-ext-task-item">
          <input type="checkbox">
          <span>${escapeHtml(a)}</span>
        </div>
      `).join('');
    }

    const tBox = getEl('jitsiTranscriptBox');
    if (tBox) {
      tBox.innerHTML = `<div style="white-space:pre-wrap; line-height:1.6;">${escapeHtml(transcriptText || '')}</div>`;
    }
  }

  function renderRecoveryBanner(interruptedSessions, onTranscribeRecovered, onDownloadRecovered, onDismiss) {
    const area = getEl('jitsiRecoveryArea');
    if (!area) return;

    if (!interruptedSessions || interruptedSessions.length === 0) {
      area.innerHTML = '';
      return;
    }

    const latest = interruptedSessions[0];
    const totalBytes = (latest.chunks || []).reduce((acc, c) => acc + (c.size || 0), 0);
    const totalKb = (totalBytes / 1024).toFixed(0);

    area.innerHTML = `
      <div id="jitsiRecoveryBanner" class="jitsi-ai-recovery-banner">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div style="font-weight:700; color:#fbbf24; font-size:12px; margin-bottom:3px; display:flex; align-items:center; gap:5px;">
            <span>⚠️</span> Interrupted Recording Recovered!
          </div>
          <button id="jitsiDismissRecoveryBtn" style="background:transparent; border:none; color:#94a3b8; font-size:14px; cursor:pointer; line-height:1;" title="Dismiss">&times;</button>
        </div>
        <div style="color:#cbd5e1; font-size:11px; margin-bottom:8px; line-height:1.4;">
          Found <strong>${latest.chunks.length} chunks</strong> (${totalKb} KB) from room <code>${escapeHtml(latest.roomName)}</code>.
        </div>
        <div style="display:flex; gap:6px;">
          <button id="jitsiTranscribeRecoveredBtn" class="jitsi-ai-ext-btn-primary" style="padding:4px 10px; font-size:11px;">
            ✨ Transcribe Recovered Call
          </button>
          <button id="jitsiDownloadRecoveredBtn" class="jitsi-ai-ext-btn-secondary" style="padding:4px 10px; font-size:11px;">
            💾 Save Audio (.webm)
          </button>
        </div>
      </div>
    `;

    const dismissBtn = getEl('jitsiDismissRecoveryBtn');
    if (dismissBtn) dismissBtn.onclick = onDismiss;

    const transBtn = getEl('jitsiTranscribeRecoveredBtn');
    if (transBtn) transBtn.onclick = () => onTranscribeRecovered(latest);

    const downBtn = getEl('jitsiDownloadRecoveredBtn');
    if (downBtn) downBtn.onclick = () => onDownloadRecovered(latest);
  }

  return {
    getEl,
    escapeHtml,
    showToast,
    switchTab,
    setRecordButtonState,
    renderChunkItem,
    renderMeetingNotes,
    renderRecoveryBanner
  };
});
