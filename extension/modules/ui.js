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

  function formatSec(s) {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
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
    const tabMap = {
      'recording': 'audio',
      'audio': 'audio',
      'notes': 'notes',
      'settings': 'settings'
    };
    const active = tabMap[tabId] || 'audio';
    ['audio', 'notes', 'settings'].forEach(t => {
      const btn = getEl(`jitsiTabBtn_${t}`) || document.querySelector(`[data-tab="${t}"]`) || (t === 'audio' ? document.querySelector(`[data-tab="recording"]`) : null);
      const content = getEl(`jitsiTabContent_${t}`) || (t === 'audio' ? getEl('jitsiRecordingTab') : (t === 'notes' ? getEl('jitsiNotesTab') : getEl('jitsiSettingsTab')));
      if (btn) btn.classList.toggle('active', t === active);
      if (content) content.style.display = (t === active) ? 'block' : 'none';
    });
  }

  function setRecordButtonState(state) {
    const recBtn = getEl('jitsiToggleRecordBtn');
    if (!recBtn) return;

    if (state === 'recording') {
      recBtn.textContent = '⏹️ Stop & Prepare Notes';
      recBtn.classList.replace('jitsi-ai-ext-btn-primary', 'jitsi-ai-ext-btn-secondary');
      recBtn.style.display = 'inline-flex';
    } else if (state === 'idle' || state === 'ready') {
      recBtn.textContent = '🔴 Start Recording Everyone';
      recBtn.classList.replace('jitsi-ai-ext-btn-secondary', 'jitsi-ai-ext-btn-primary');
      recBtn.style.display = 'inline-flex';
    } else if (state === 'record_again') {
      recBtn.textContent = '🔴 Record Again';
      recBtn.classList.replace('jitsi-ai-ext-btn-secondary', 'jitsi-ai-ext-btn-primary');
      recBtn.style.display = 'inline-flex';
    }
  }

  /**
   * Renders active in-progress block progress card
   */
  function renderActiveBlockProgress({ blockIndex, elapsedSec, totalSec, startSec }) {
    const list = getEl('jitsiChunksList');
    if (!list) return;
    const placeholder = list.querySelector('em');
    if (placeholder) placeholder.remove();

    let activeCard = getEl('jitsiActiveBlockCard');
    if (!activeCard) {
      activeCard = document.createElement('div');
      activeCard.id = 'jitsiActiveBlockCard';
      activeCard.style.cssText = 'background:rgba(99,102,241,0.08); border:1px dashed rgba(99,102,241,0.5); border-radius:6px; padding:7px 10px; font-size:11px; margin-bottom:6px;';
      list.prepend(activeCard);
    }

    const startFormatted = formatSec(startSec);
    const endFormatted = formatSec(startSec + totalSec);
    const progressPct = Math.min(100, Math.round((elapsedSec / totalSec) * 100));

    activeCard.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
        <div>
          <span style="color:#a5b4fc; font-weight:700;">Block #${blockIndex} (Recording)</span>
          <span style="color:#94a3b8; font-size:10px; margin-left:6px;">[${startFormatted} - ${endFormatted}]</span>
        </div>
        <span class="jitsi-ai-badge" style="background:rgba(239,68,68,0.2); color:#fca5a5; border:1px solid rgba(239,68,68,0.4); font-size:10px; padding:2px 6px; border-radius:10px;">
          ⏳ ${formatSec(elapsedSec)} / ${formatSec(totalSec)}
        </span>
      </div>
      <div style="width:100%; height:3px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden;">
        <div style="width:${progressPct}%; height:100%; background:#6366f1; transition:width 0.3s ease;"></div>
      </div>
    `;
  }

  /**
   * Renders completed 3-6 minute block in the sidebar
   */
  function renderBlockItem(block, status = 'transcribing') {
    const list = getEl('jitsiChunksList');
    if (!list) return;

    // Remove active card placeholder if it matches this block
    const activeCard = getEl('jitsiActiveBlockCard');
    if (activeCard) activeCard.remove();

    const placeholder = list.querySelector('em');
    if (placeholder) placeholder.remove();

    let item = getEl(`block_card_${block.index}`);
    if (!item) {
      item = document.createElement('div');
      item.id = `block_card_${block.index}`;
      item.className = 'jitsi-ai-block-card';
      item.style.cssText = 'background:rgba(30,41,59,0.7); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:7px 10px; font-size:11px; margin-bottom:5px;';
      list.prepend(item);
    }

    const isReady = status === 'completed';
    const statusHtml = isReady
      ? `<span id="block_status_${block.index}" class="jitsi-ai-badge" style="background:rgba(16,185,129,0.2); color:#34d399; border:1px solid rgba(16,185,129,0.4); font-size:10px; padding:2px 7px; border-radius:10px;">✅ Transcribed</span>`
      : `<span id="block_status_${block.index}" class="jitsi-ai-badge" style="background:rgba(99,102,241,0.2); color:#a5b4fc; border:1px solid rgba(99,102,241,0.4); font-size:10px; padding:2px 7px; border-radius:10px;">⚡ Transcribing in Background...</span>`;

    item.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
        <div>
          <span style="color:#818cf8; font-weight:700;">Block #${block.index}</span>
          <span style="color:#cbd5e1; font-size:11px; font-weight:600; margin-left:6px;">[${block.startTime} - ${block.endTime}]</span>
        </div>
        ${statusHtml}
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#94a3b8;">
        <span>${block.sizeKb || 'Clean'} KB Audio</span>
        <span id="block_preview_${block.index}" style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#e2e8f0; font-style:italic;">
          ${block.preview ? `"${escapeHtml(block.preview)}"` : 'Audio secured in vault'}
        </span>
      </div>
    `;

    const badge = getEl('jitsiChunkCountBadge');
    if (badge) {
      const realCards = list.querySelectorAll('.jitsi-ai-block-card');
      badge.textContent = realCards.length;
    }
  }

  function updateBlockStatus(blockIndex, status, transcriptPreview = '', onRetry = null) {
    const statusEl = getEl(`block_status_${blockIndex}`);
    const prevEl = getEl(`block_preview_${blockIndex}`);

    // Clean up existing retry button if present
    const existingRetry = getEl(`block_retry_${blockIndex}`);
    if (existingRetry) existingRetry.remove();

    if (statusEl) {
      if (status === 'completed') {
        statusEl.style.background = 'rgba(16,185,129,0.2)';
        statusEl.style.color = '#34d399';
        statusEl.style.borderColor = 'rgba(16,185,129,0.4)';
        statusEl.textContent = '✅ Transcribed';
        if (prevEl) {
          prevEl.style.color = '#e2e8f0';
          prevEl.textContent = transcriptPreview ? `"${transcriptPreview.slice(0, 65)}..."` : 'Audio transcribed';
        }
      } else if (status === 'error') {
        statusEl.style.background = 'rgba(239,68,68,0.2)';
        statusEl.style.color = '#f87171';
        statusEl.style.borderColor = 'rgba(239,68,68,0.4)';
        statusEl.textContent = '⚠️ Error';

        if (statusEl.parentElement && onRetry) {
          const retryBtn = document.createElement('button');
          retryBtn.id = `block_retry_${blockIndex}`;
          retryBtn.style.cssText = 'background:#4f46e5; color:#ffffff; border:none; border-radius:4px; padding:2px 7px; font-size:10px; cursor:pointer; font-weight:600; margin-left:6px; transition:all 0.2s;';
          retryBtn.textContent = '🔄 Retry';
          retryBtn.title = 'Retry transcribing this block';
          retryBtn.onmouseenter = () => { retryBtn.style.background = '#4338ca'; };
          retryBtn.onmouseleave = () => { retryBtn.style.background = '#4f46e5'; };
          retryBtn.onclick = (e) => {
            e.stopPropagation();
            onRetry();
          };
          statusEl.parentElement.appendChild(retryBtn);
        }

        if (prevEl) {
          prevEl.style.color = '#f87171';
          prevEl.textContent = transcriptPreview ? `⚠️ ${transcriptPreview.slice(0, 75)}` : 'Transcription failed (Click Retry)';
          prevEl.title = transcriptPreview || 'Click Retry to re-transcribe';
        }
      } else if (status === 'retrying') {
        statusEl.style.background = 'rgba(245,158,11,0.2)';
        statusEl.style.color = '#fbbf24';
        statusEl.style.borderColor = 'rgba(245,158,11,0.4)';
        statusEl.textContent = '⚡ Retrying...';
        if (prevEl) {
          prevEl.style.color = '#cbd5e1';
          prevEl.textContent = transcriptPreview ? `Retrying (${transcriptPreview.slice(0, 50)})...` : 'Reconnecting to Gemini AI...';
        }
      } else {
        statusEl.textContent = status;
        if (prevEl && transcriptPreview) {
          prevEl.textContent = `"${transcriptPreview.slice(0, 60)}..."`;
        }
      }
    }
  }

  // Alias for backward compatibility
  function renderChunkItem(chunk) {
    renderBlockItem({
      index: chunk.index,
      startTime: chunk.timestamp || '00:00',
      endTime: 'Saved',
      sizeKb: chunk.sizeKb
    }, 'completed');
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
        <div style="font-size:11px; color:#cbd5e1; margin-bottom:6px;">
          Found <strong>${latest.chunkCount || latest.chunks?.length || 0} audio chunks</strong> (${totalKb} KB) from previous session.
        </div>
        <div style="display:flex; gap:6px;">
          <button id="jitsiRecoverTranscribeBtn" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-primary" style="padding:4px 8px; font-size:10px; flex:1;">
            ⚡ Transcribe Recovered
          </button>
          <button id="jitsiRecoverDownloadBtn" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-secondary" style="padding:4px 8px; font-size:10px; flex:1;">
            💾 Download Audio
          </button>
        </div>
      </div>
    `;

    const transBtn = getEl('jitsiRecoverTranscribeBtn');
    if (transBtn && onTranscribeRecovered) {
      transBtn.onclick = () => onTranscribeRecovered(latest);
    }
    const downBtn = getEl('jitsiRecoverDownloadBtn');
    if (downBtn && onDownloadRecovered) {
      downBtn.onclick = () => onDownloadRecovered(latest);
    }
    const disBtn = getEl('jitsiDismissRecoveryBtn');
    if (disBtn && onDismiss) {
      disBtn.onclick = () => onDismiss(latest.id);
    }
  }

  return {
    showToast,
    switchTab,
    setRecordButtonState,
    renderActiveBlockProgress,
    renderBlockItem,
    updateBlockStatus,
    renderChunkItem,
    renderMeetingNotes,
    renderRecoveryBanner,
    escapeHtml
  };
});
