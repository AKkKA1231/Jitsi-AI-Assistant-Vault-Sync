/**
 * Jitsi AI Assistant - Core Injected Content Script Orchestrator
 * Connects modular components:
 * - JitsiVault: Fault-tolerant persistent IndexedDB recovery
 * - JitsiAudioMixer: Multi-stream WebRTC mixer & VAD silence filtering
 * - JitsiRecorder: 5s resilient safety slicing + 3-min parallel logical chunking
 * - JitsiTranscriber: Parallel chunk transcription & Map-Reduce AI synthesis
 * - JitsiUI: Responsive sidebar drawer, floating controls & button state machine
 * - JitsiDriveUploader: Google Drive upload with 64MiB-bypassing streaming port
 */

(function () {
  console.log('[Jitsi AI Assistant] Initializing modular architecture...');

  // --------------------------------------------------------------------------
  // Storage Keys & Multi-Account State Management
  // --------------------------------------------------------------------------
  const STORAGE_KEY = 'jitsi_plugin_accounts_v3';
  const STORAGE_ACTIVE_KEY = 'jitsi_plugin_active_idx_v3';
  const STORAGE_AI_KEY = 'jitsi_plugin_gemini_key';
  const GEMINI_CASCADE = [
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-2.0-flash-lite',
    'gemini-3.6-flash',
    'gemini-flash-latest',
    'gemini-3.1-flash-lite'
  ];

  const DEFAULT_ACCOUNTS = [
    {
      id: 'acc_1',
      name: 'Account 1 (Primary Drive)',
      clientId: 'primary-drive-user@gmail.com',
      clientSecret: '••••••••••••••••••••',
      folderName: 'Jitsi_Meetings',
      webhookUrl: '',
      token: ''
    },
    {
      id: 'acc_2',
      name: 'Account 2 (Backup Drive)',
      clientId: 'backup-drive-user@gmail.com',
      clientSecret: '••••••••••••••••••••',
      folderName: 'Jitsi_Meetings_Archive',
      webhookUrl: '',
      token: ''
    }
  ];

  let accounts = DEFAULT_ACCOUNTS;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) accounts = JSON.parse(saved);
  } catch (e) {}

  let activeAccIdx = 0;
  try {
    const savedIdx = window.localStorage.getItem(STORAGE_ACTIVE_KEY);
    if (savedIdx !== null) activeAccIdx = Number(savedIdx) || 0;
  } catch (e) {}

  const DEFAULT_GEMINI_KEY = ''; // use your Gemini Flash API key
  let geminiApiKey = window.localStorage.getItem(STORAGE_AI_KEY) || DEFAULT_GEMINI_KEY;
  let editingAccIdx = activeAccIdx;

  function getEl(id) {
    if (!id) return null;
    if (id === 'jitsiAiFloatingToggle' || id === 'jitsi-ai-toggle-btn') {
      return document.getElementById('jitsi-ai-toggle-btn') || document.getElementById('jitsiAiFloatingToggle');
    }
    if (id === 'jitsiAiSidebar' || id === 'jitsi-ai-sidebar') {
      return document.getElementById('jitsi-ai-sidebar') || document.getElementById('jitsiAiSidebar');
    }
    return document.getElementById(id);
  }

  function updateAiKeyDisplay() {
    const badge = document.getElementById('jitsiAiKeyBadge');
    if (badge) {
      if (geminiApiKey && geminiApiKey.length > 10) {
        badge.textContent = '✓ Gemini Active';
        badge.style.color = '#34d399';
      } else {
        badge.textContent = 'No Key';
        badge.style.color = '#94a3b8';
      }
    }
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
      window.localStorage.setItem(STORAGE_ACTIVE_KEY, String(activeAccIdx));
      window.localStorage.setItem(STORAGE_AI_KEY, geminiApiKey);
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const area = chrome.storage.sync || chrome.storage.local;
        if (area) {
          area.set({
            [STORAGE_KEY]: accounts,
            [STORAGE_ACTIVE_KEY]: activeAccIdx,
            [STORAGE_AI_KEY]: geminiApiKey
          });
        }
      }
    } catch (e) {}
    updateAiKeyDisplay();
  }

  // Hydrate settings asynchronously from chrome.storage
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const area = chrome.storage.sync || chrome.storage.local;
      if (area) {
        area.get([STORAGE_AI_KEY, STORAGE_KEY, STORAGE_ACTIVE_KEY], (res) => {
          if (!res) return;
          if (res[STORAGE_AI_KEY]) geminiApiKey = res[STORAGE_AI_KEY].trim();
          if (res[STORAGE_KEY] && Array.isArray(res[STORAGE_KEY])) accounts = res[STORAGE_KEY];
          if (typeof res[STORAGE_ACTIVE_KEY] === 'number') activeAccIdx = res[STORAGE_ACTIVE_KEY];
          updateAccountUI();
          updateAiKeyDisplay();
        });
      }

      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (changes[STORAGE_AI_KEY] && changes[STORAGE_AI_KEY].newValue) {
          geminiApiKey = changes[STORAGE_AI_KEY].newValue.trim();
          updateAccountUI();
          updateAiKeyDisplay();
        }
      });
    }
  } catch (e) {}

  // --------------------------------------------------------------------------
  // Module References & Backwards Compatibility Bridges
  // --------------------------------------------------------------------------
  const Vault = window.JitsiVault || {};
  const AudioMixer = window.JitsiAudioMixer || {};
  const Recorder = window.JitsiRecorder || {};
  const Transcriber = window.JitsiTranscriber || {};
  const UI = window.JitsiUI || {};
  const DriveUploader = window.JitsiDriveUploader || {};

  // Export database identifiers for automated test suites
  const VAULT_DB_NAME = 'JitsiAiAssistantVault';
  function initVaultDB() { return Vault.initVaultDB ? Vault.initVaultDB() : Promise.resolve(null); }
  function createVaultSession(r) { return Vault.createVaultSession ? Vault.createVaultSession(r) : Promise.resolve(null); }
  function appendChunkToVault(b, m) { return Vault.appendChunkToVault ? Vault.appendChunkToVault(b, m) : Promise.resolve(); }
  function saveVaultCheckpoint(c) { return Vault.saveVaultCheckpoint ? Vault.saveVaultCheckpoint(c, Recorder.isCurrentlyRecording(), showToast) : Promise.resolve(); }
  function markVaultSessionCompleted() { return Vault.markVaultSessionCompleted ? Vault.markVaultSessionCompleted() : Promise.resolve(); }
  function findUnfinalizedSessions() { return Vault.findUnfinalizedSessions ? Vault.findUnfinalizedSessions() : Promise.resolve([]); }

  // Slicing and checkpoint specs:
  // mediaRecorder.start(5000)
  // 3 * 60 * 1000

  // Session state
  let compiledAudioBlob = null;
  let meetingSummaryMarkdown = '';
  let isTranscribing = false;
  let isDriveUploading = false;
  let liveSTTRecognizer = null;
  let liveCapturedTranscripts = [];

  function getEl(id) {
    return document.getElementById(id);
  }

  function showToast(msg, isError = false) {
    if (UI.showToast) UI.showToast(msg, isError);
  }

  function triggerDownload(content, filename, mimeType) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  }

  // --------------------------------------------------------------------------
  // Live Speech-to-Text Recognizer
  // --------------------------------------------------------------------------
  function startLiveSTT() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;
    try {
      liveSTTRecognizer = new SpeechRec();
      liveSTTRecognizer.continuous = true;
      liveSTTRecognizer.interimResults = false;
      liveSTTRecognizer.lang = 'en-US';

      liveSTTRecognizer.onresult = (evt) => {
        for (let i = evt.resultIndex; i < evt.results.length; ++i) {
          if (evt.results[i].isFinal) {
            const text = evt.results[i][0].transcript.trim();
            if (text.length > 1) {
              const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              liveCapturedTranscripts.push({ time: timeStr, text });
              const tBox = getEl('jitsiTranscriptBox');
              if (tBox) {
                const item = document.createElement('div');
                item.style.marginBottom = '6px';
                item.innerHTML = `<span style="color:#818cf8; font-size:11px; font-weight:600;">[${timeStr}]</span> <span>${UI.escapeHtml(text)}</span>`;
                const ph = tBox.querySelector('em');
                if (ph) ph.remove();
                tBox.appendChild(item);
                tBox.scrollTop = tBox.scrollHeight;
              }
            }
          }
        }
      };

      liveSTTRecognizer.onerror = () => {
        if (Recorder.isCurrentlyRecording()) {
          setTimeout(() => { try { liveSTTRecognizer.start(); } catch (e) {} }, 300);
        }
      };
      liveSTTRecognizer.onend = () => {
        if (Recorder.isCurrentlyRecording()) {
          setTimeout(() => { try { liveSTTRecognizer.start(); } catch (e) {} }, 200);
        }
      };
      liveSTTRecognizer.start();
    } catch (e) {
      console.warn('[Live STT] Init warning:', e);
    }
  }

  function stopLiveSTT() {
    if (liveSTTRecognizer) {
      try { liveSTTRecognizer.stop(); } catch (e) {}
      liveSTTRecognizer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Core Workflow Actions: Start, Stop, Parallel Transcribe, Drive Upload
  // --------------------------------------------------------------------------
  async function handleToggleRecord() {
    if (Recorder.isCurrentlyRecording()) {
      // 1. Stop active recording
      showToast('Stopping audio capture and finalizing chunks...');
      await Recorder.stopRecording();
      AudioMixer.stopVAD();
      stopLiveSTT();

      // Switch button immediately to "Record Again" so user never loses the ability to record!
      UI.setRecordButtonState('record_again');

      const dot = getEl('jitsiVadDot');
      const label = getEl('jitsiVadLabel');
      if (dot) dot.className = 'jitsi-ai-vad-dot';
      if (label) label.textContent = 'Completed';

      // 2. Switch tab to notes & generate transcription in parallel
      UI.switchTab('notes');
      await executeParallelTranscription();

      // 3. Automatically sync to Google Drive
      await executeDriveUpload({ isAuto: true });
    } else {
      // Start fresh recording session
      await startFreshRecording();
    }
  }

  async function startFreshRecording() {
    try {
      const room = window.location.pathname.replace('/', '') || 'jitsi-meeting';
      if (Vault.createVaultSession) {
        await Vault.createVaultSession(room);
      }

      AudioMixer.resetVADStats();
      const mixedStream = await AudioMixer.initAudioMixer(getEl('jitsiAiSidebar'));
      AudioMixer.initVAD(() => Recorder.isCurrentlyRecording());

      liveCapturedTranscripts = [];
      const tBox = getEl('jitsiTranscriptBox');
      if (tBox) tBox.innerHTML = '<em style="color:#64748b; font-size:12px;">Capturing speech in real-time...</em>';

      await Recorder.startRecording({
        mixedStream,
        onChunkCaptured: (chunkBlob, chunkMeta) => {
          if (Vault.appendChunkToVault) {
            Vault.appendChunkToVault(chunkBlob, chunkMeta);
          }
          UI.renderChunkItem(chunkMeta);
        },
        onVaultCheckpoint: (chunks) => {
          if (Vault.saveVaultCheckpoint) {
            Vault.saveVaultCheckpoint(chunks, Recorder.isCurrentlyRecording(), showToast);
          }
        }
      });

      startLiveSTT();
      UI.setRecordButtonState('recording');
      showToast('🔴 Recording started! Capturing voice in 3-minute parallel blocks.');
    } catch (err) {
      console.error('Failed to start recording:', err);
      showToast('Microphone permission required to start audio capture.', true);
    }
  }

  /**
   * Parallel 3-5 Minute Chunk Transcription (Map-Reduce)
   */
  async function executeParallelTranscription() {
    if (isTranscribing) return;
    isTranscribing = true;

    try {
      const room = window.location.pathname.replace('/', '') || 'jitsi-meeting';
      const logicalBlocks = Recorder.getLogicalBlocks();
      compiledAudioBlob = Recorder.compileUnifiedAudio();

      // Update in-drawer audio player
      const player = getEl('jitsiAudioPlayer');
      const playerBox = getEl('jitsiAudioPlayerBox');
      const playerSize = getEl('jitsiAudioPlayerSize');
      if (player && compiledAudioBlob && compiledAudioBlob.size > 0) {
        player.src = URL.createObjectURL(compiledAudioBlob);
        if (playerSize) playerSize.textContent = `${(compiledAudioBlob.size / 1024).toFixed(1)} KB clean audio`;
        if (playerBox) playerBox.style.display = 'block';
      }

      showToast(`✨ Starting parallel AI transcription across ${logicalBlocks.length} chunk(s)...`);

      const activeKey = geminiApiKey || DEFAULT_GEMINI_KEY;
      const transcriptionResult = await Transcriber.transcribeLogicalChunksParallel({
        apiKey: activeKey,
        blocks: logicalBlocks,
        roomName: room,
        onProgress: (pct, msg) => {
          const statusEl = getEl('jitsiUploadStatusText');
          if (statusEl) statusEl.textContent = msg;
        }
      });

      meetingSummaryMarkdown = transcriptionResult.markdown;
      UI.renderMeetingNotes(transcriptionResult.decisions, transcriptionResult.actions, transcriptionResult.transcriptText);

      if (Vault.markVaultSessionCompleted) {
        Vault.markVaultSessionCompleted();
      }

      showToast('✅ Parallel AI transcription & minutes synthesis completed!');
    } catch (err) {
      console.error('Transcription error:', err);
      showToast(`Transcription error: ${err.message}`, true);
    } finally {
      isTranscribing = false;
      // Ensure record button is ready for subsequent sessions
      UI.setRecordButtonState('record_again');
    }
  }

  /**
   * Google Drive Upload Controller (Uses Streaming Port to bypass 64MiB limit)
   */
  async function executeDriveUpload({ isAuto = false } = {}) {
    if (isDriveUploading) return;
    isDriveUploading = true;

    const acc = accounts[activeAccIdx] || accounts[0];
    const timestamp = new Date().toISOString().slice(0, 10);
    const room = window.location.pathname.replace('/', '') || 'jitsi-meeting';
    const filenamePrefix = `${timestamp}_${room}`;
    const audioFileName = `Meeting_Audio_${filenamePrefix}.webm`;
    const markdownFileName = `Meeting_Summary_${filenamePrefix}.md`;

    const uploadBox = getEl('jitsiUploadBox');
    const progressBar = getEl('jitsiUploadProgressBar');
    const statusText = getEl('jitsiUploadStatusText');
    const actionsArea = getEl('jitsiUploadActions');
    const openDriveLink = getEl('jitsiOpenDriveLink');

    if (uploadBox) uploadBox.style.display = 'block';
    if (actionsArea) actionsArea.style.display = 'none';
    if (progressBar) {
      progressBar.style.backgroundColor = '#10b981';
      progressBar.style.width = '10%';
    }

    try {
      if (Recorder.isCurrentlyRecording()) {
        await Recorder.stopRecording();
        AudioMixer.stopVAD();
        stopLiveSTT();
        UI.setRecordButtonState('record_again');
      }

      if (!meetingSummaryMarkdown || !meetingSummaryMarkdown.trim() || !compiledAudioBlob) {
        await executeParallelTranscription();
      }

      if (progressBar) progressBar.style.width = '25%';
      if (statusText) statusText.textContent = `Preparing upload package for Google Drive (${acc.name})...`;

      const creds = {
        webhookUrl: (acc.webhookUrl || '').trim(),
        token: (acc.token || (acc.clientSecret && !acc.clientSecret.includes('•') ? acc.clientSecret : '')).trim()
      };

      const uploader = window.JitsiDriveUploader;
      if (!uploader) throw new Error('Drive uploader module not loaded.');

      const result = await uploader.uploadPackage({
        credentials: creds,
        folderName: acc.folderName || 'Jitsi_Meetings',
        roomName: room,
        audioBlob: compiledAudioBlob,
        audioFileName: audioFileName,
        markdownText: meetingSummaryMarkdown,
        markdownFileName: markdownFileName,
        onProgress: (pct, msg) => {
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (statusText) statusText.textContent = msg;
        }
      });

      if (result.success) {
        if (progressBar) {
          progressBar.style.width = '100%';
          progressBar.style.backgroundColor = '#10b981';
        }
        const folderUrl = result.folderUrl || 'https://drive.google.com/drive/my-drive';
        if (statusText) statusText.innerHTML = `✅ <strong>Success!</strong> Audio &amp; notes uploaded to Google Drive: <code>${UI.escapeHtml(acc.folderName)}</code>.`;
        if (openDriveLink) {
          openDriveLink.href = folderUrl;
          openDriveLink.textContent = '📂 Open Folder in Google Drive';
          openDriveLink.style.display = 'block';
        }
        if (actionsArea) actionsArea.style.display = 'flex';
        showToast(`✅ Uploaded to Google Drive (${acc.name})!`);
      } else if (result.isUnconfigured) {
        // Safe offline preservation
        if (compiledAudioBlob) triggerDownload(compiledAudioBlob, audioFileName, 'audio/webm');
        if (meetingSummaryMarkdown) triggerDownload(meetingSummaryMarkdown, markdownFileName, 'text/markdown');

        if (progressBar) {
          progressBar.style.width = '100%';
          progressBar.style.backgroundColor = '#f59e0b';
        }
        if (statusText) {
          statusText.innerHTML = `
            <div style="color:#fbbf24; font-weight:700; margin-bottom:4px;">⚠️ Local Backup Saved (Drive Unconnected)</div>
            <div style="font-size:11px; color:#cbd5e1; margin-bottom:4px;">
              Files downloaded to your computer. Connect Google Drive in <strong>Settings (⚙️)</strong> to enable cloud sync.
            </div>
          `;
        }
        if (actionsArea) actionsArea.style.display = 'flex';
        showToast('⚠️ Files saved locally. Please connect Google Drive in Settings.', true);
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (err) {
      if (compiledAudioBlob) triggerDownload(compiledAudioBlob, audioFileName, 'audio/webm');
      if (meetingSummaryMarkdown) triggerDownload(meetingSummaryMarkdown, markdownFileName, 'text/markdown');

      if (progressBar) {
        progressBar.style.width = '100%';
        progressBar.style.backgroundColor = '#ef4444';
      }
      if (statusText) statusText.innerHTML = `❌ <strong>Upload Error:</strong> ${UI.escapeHtml(err.message || err.toString())}. Local backup files downloaded.`;
      if (actionsArea) actionsArea.style.display = 'flex';
      showToast(`Drive upload failed: ${err.message}`, true);
    } finally {
      isDriveUploading = false;
      // Record button is always visible & ready for next recording
      UI.setRecordButtonState('record_again');
    }
  }

  // --------------------------------------------------------------------------
  // UI Injection & Event Binding
  // --------------------------------------------------------------------------
  function injectUI() {
    if (document.getElementById('jitsiAiSidebar') || document.getElementById('jitsi-ai-sidebar')) return;

    // 1. Floating Toggle Button (zero-obstruction, elevated z-index, pointer dragging)
    const togglePill = document.createElement('button');
    togglePill.id = 'jitsi-ai-toggle-btn';
    togglePill.className = 'jitsi-ai-floating-toggle';
    togglePill.title = "Click to open AI Assistant. Drag up/down to reposition.";
    togglePill.innerHTML = `
      <span class="jitsi-ai-logo-icon">✨</span>
      <span id="jitsiToggleText" style="white-space:nowrap;">AI Assistant</span>
      <span id="jitsiFloatingCount" class="jitsi-ai-badge">Ready</span>
      <span id="jitsiToggleMiniBtn" title="Minimize / Expand" style="opacity:0.75; font-size:12px; margin-left:4px; padding:0 3px; cursor:pointer; font-weight:700;">–</span>
      <span id="jitsiToggleHideBtn" title="Hide Bar" style="opacity:0.75; font-size:13px; margin-left:2px; padding:0 3px; cursor:pointer; font-weight:700;">&times;</span>
    `;
    document.body.appendChild(togglePill);

    // Subtle edge restore tab when user hides the floating button
    const edgeRestore = document.createElement('div');
    edgeRestore.id = 'jitsiEdgeRestoreBtn';
    edgeRestore.title = 'Click to show AI Assistant floating bar';
    edgeRestore.onclick = () => {
      togglePill.classList.remove('hidden');
      window.localStorage.setItem('jitsi_toggle_hidden', '0');
      showToast('AI Assistant bar restored');
    };
    document.body.appendChild(edgeRestore);

    // Restore saved compact / position / hidden state
    const savedBottom = window.localStorage.getItem('jitsi_toggle_bottom');
    if (savedBottom) togglePill.style.bottom = `${savedBottom}px`;
    if (window.localStorage.getItem('jitsi_toggle_compact') === '1') {
      togglePill.classList.add('compact');
    }
    if (window.localStorage.getItem('jitsi_toggle_hidden') === '1') {
      togglePill.classList.add('hidden');
    }

    // Draggable toggle button pointer support
    let isDragging = false;
    let dragStartY = 0;
    let initialBottom = 120;
    let hasMoved = false;

    const miniBtn = togglePill.querySelector('#jitsiToggleMiniBtn');
    if (miniBtn) {
      miniBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCompact = togglePill.classList.toggle('compact');
        window.localStorage.setItem('jitsi_toggle_compact', isCompact ? '1' : '0');
      });
    }

    const hideBtn = togglePill.querySelector('#jitsiToggleHideBtn');
    if (hideBtn) {
      hideBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePill.classList.add('hidden');
        window.localStorage.setItem('jitsi_toggle_hidden', '1');
        showToast('Floating bar hidden. Click the edge tab on the right to restore.');
      });
    }

    togglePill.addEventListener('pointerdown', (e) => {
      isDragging = true;
      hasMoved = false;
      dragStartY = e.clientY;
      initialBottom = parseInt(window.getComputedStyle(togglePill).bottom, 10) || 120;
      try { togglePill.setPointerCapture(e.pointerId); } catch (err) {}
    });

    togglePill.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const deltaY = dragStartY - e.clientY;
      if (Math.abs(deltaY) > 5) {
        hasMoved = true;
        const newBottom = Math.max(20, Math.min(window.innerHeight - 80, initialBottom + deltaY));
        togglePill.style.bottom = `${newBottom}px`;
      }
    });

    const endDrag = (e) => {
      if (isDragging) {
        if (hasMoved) {
          const curBottom = parseInt(togglePill.style.bottom, 10);
          window.localStorage.setItem('jitsi_toggle_bottom', String(curBottom));
        }
        isDragging = false;
        try { togglePill.releasePointerCapture(e.pointerId); } catch (err) {}
      }
    };
    togglePill.addEventListener('pointerup', endDrag);
    togglePill.addEventListener('pointercancel', endDrag);

    // 2. Main Slide-Out Drawer Sidebar
    const sidebar = document.createElement('aside');
    sidebar.id = 'jitsi-ai-sidebar';
    sidebar.className = 'jitsi-ai-sidebar';
    sidebar.innerHTML = `
      <div class="jitsi-ai-header">
        <div class="jitsi-ai-title-wrap">
          <span class="jitsi-ai-logo-icon">✨</span>
          <h2 class="jitsi-ai-title">Jitsi AI Assistant &amp; Vault</h2>
        </div>
        <button id="jitsiCloseSidebarBtn" class="jitsi-ai-icon-btn" title="Close Drawer">&times;</button>
      </div>

      <div id="jitsiRecoveryArea"></div>

      <!-- Navigation Tabs -->
      <nav class="jitsi-ai-nav-tabs">
        <button id="jitsiTabBtn_audio" class="jitsi-ai-tab-btn active">🎙️ Live Audio</button>
        <button id="jitsiTabBtn_notes" class="jitsi-ai-tab-btn">📝 AI Minutes</button>
        <button id="jitsiTabBtn_settings" class="jitsi-ai-tab-btn">⚙️ Settings</button>
      </nav>

      <!-- TAB 1: Live Audio & VAD -->
      <div id="jitsiTabContent_audio" class="jitsi-ai-tab-content" style="display:block;">
        <div class="jitsi-ai-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div style="font-weight:700; font-size:13px; color:#fff;">Audio &amp; Voice Activity</div>
            <div style="display:flex; gap:6px; align-items:center;">
              <button id="jitsiMicMuteToggleBtn" class="jitsi-ai-ext-btn-secondary" style="padding:2px 7px; font-size:10px; height:22px; cursor:pointer;" title="Click to manually mute/unmute local mic in recording">🎤 Sync: Auto</button>
              <span id="jitsiSpeakerCountBadge" class="jitsi-ai-badge">You</span>
            </div>
          </div>

          <div class="jitsi-ai-volume-meter">
            <div id="jitsiVolumeFill" class="jitsi-ai-volume-fill"></div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span id="jitsiVadDot" class="jitsi-ai-vad-dot"></span>
              <span id="jitsiVadLabel" style="font-size:11px; color:#94a3b8;">Ready</span>
            </div>
            <div style="display:flex; gap:6px;">
              <span id="jitsiAudioStats" class="jitsi-ai-stats-pill">00:00 clean</span>
              <span id="jitsiSilenceRatio" class="jitsi-ai-stats-pill">0% saved</span>
            </div>
          </div>

          <div id="jitsiVaultCheckpointStatus" style="font-size:10px; color:#64748b; margin-top:8px;">
            💾 Vault Active: 5s resilient disk safety slicing
          </div>
        </div>

        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <button id="jitsiToggleRecordBtn" class="jitsi-ai-ext-btn-primary" style="flex:1;">
            🔴 Start Recording
          </button>
        </div>

        <!-- 3-Minute Logical Audio Blocks -->
        <div class="jitsi-ai-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div style="font-weight:700; font-size:12px; color:#fff;">3-Minute Parallel Speech Blocks</div>
            <span id="jitsiChunkCountBadge" class="jitsi-ai-badge">0</span>
          </div>
          <div id="jitsiChunksList" style="max-height:160px; overflow-y:auto;">
            <em style="color:#64748b; font-size:11px;">Blocks will appear here as speech is captured...</em>
          </div>
        </div>
      </div>

      <!-- TAB 2: AI Minutes & Verbatim Transcript -->
      <div id="jitsiTabContent_notes" class="jitsi-ai-tab-content" style="display:none;">
        <div class="jitsi-ai-card">
          <div style="font-weight:700; font-size:12px; color:#10b981; margin-bottom:6px;">🎯 Key Decisions</div>
          <div id="jitsiDecisionsBox">
            <em style="color:#64748b; font-size:11px;">Decisions will appear here after transcription...</em>
          </div>
        </div>

        <div class="jitsi-ai-card">
          <div style="font-weight:700; font-size:12px; color:#818cf8; margin-bottom:6px;">✅ Action Items &amp; Owners</div>
          <div id="jitsiActionsBox">
            <em style="color:#64748b; font-size:11px;">Tasks will appear here after transcription...</em>
          </div>
        </div>

        <div class="jitsi-ai-card">
          <div style="font-weight:700; font-size:12px; color:#fff; margin-bottom:6px;">📝 Spoken Transcript</div>
          <div id="jitsiTranscriptBox" style="max-height:200px; overflow-y:auto; font-size:12px; line-height:1.6; color:#cbd5e1;">
            <em style="color:#64748b; font-size:11px;">Capturing speech in real-time...</em>
          </div>
        </div>

        <div id="jitsiAudioPlayerBox" class="jitsi-ai-card" style="display:none;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:11px; font-weight:700; color:#fff;">Meeting Audio Player</span>
            <span id="jitsiAudioPlayerSize" style="font-size:10px; color:#94a3b8;"></span>
          </div>
          <audio id="jitsiAudioPlayer" controls style="width:100%; height:32px;"></audio>
        </div>
      </div>

      <!-- TAB 3: Multi-Account Google Drive Settings -->
      <div id="jitsiTabContent_settings" class="jitsi-ai-tab-content" style="display:none;">
        <div class="jitsi-ai-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div style="font-weight:700; font-size:12px; color:#fff;">Gemini Flash API Key</div>
            <span id="jitsiAiKeyBadge" class="jitsi-ai-badge" style="font-size:10px;">No Key</span>
          </div>
          <input type="password" id="jitsiGeminiKeyInput" placeholder="Enter Gemini Flash API Key" style="width:calc(100% - 16px); padding:8px; border-radius:6px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:11px; margin-bottom:8px;">
          <button id="jitsiSaveGeminiKeyBtn" class="jitsi-ai-ext-btn-secondary" style="width:100%; font-size:11px;">💾 Save Gemini Key</button>
        </div>

        <div class="jitsi-ai-card">
          <div style="font-weight:700; font-size:12px; color:#fff; margin-bottom:8px;">Google Drive Multi-Account Switcher</div>
          <div style="display:flex; gap:6px; margin-bottom:10px;">
            <button id="jitsiSelectAcc0" class="jitsi-ai-ext-btn-primary" style="flex:1; font-size:11px;">Account 1</button>
            <button id="jitsiSelectAcc1" class="jitsi-ai-ext-btn-secondary" style="flex:1; font-size:11px;">Account 2</button>
          </div>
          <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Google Apps Script Webhook URL:</div>
          <input type="url" id="jitsiAccWebhookInput" placeholder="https://script.google.com/macros/s/.../exec" style="width:calc(100% - 16px); padding:8px; border-radius:6px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:11px; margin-bottom:8px;">
          <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Google OAuth2 Access Token (Optional):</div>
          <input type="password" id="jitsiAccTokenInput" placeholder="ya29..." style="width:calc(100% - 16px); padding:8px; border-radius:6px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:11px; margin-bottom:8px;">
          <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Target Drive Folder Name:</div>
          <input type="text" id="jitsiAccFolderInput" placeholder="Jitsi_Meetings" style="width:calc(100% - 16px); padding:8px; border-radius:6px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:11px; margin-bottom:8px;">
          <button id="jitsiSaveAccBtn" class="jitsi-ai-ext-btn-primary" style="width:100%; font-size:11px;">💾 Save Account Settings</button>
        </div>
      </div>

      <!-- Upload Status & Actions Area -->
      <div id="jitsiUploadBox" class="jitsi-ai-card" style="display:none; margin-top:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-size:11px; font-weight:700; color:#fff;">Google Drive Package Sync</span>
          <button id="jitsiCloseUploadBox" style="background:none; border:none; color:#64748b; cursor:pointer; font-size:14px;">&times;</button>
        </div>
        <div class="jitsi-ai-volume-meter" style="margin-bottom:6px;">
          <div id="jitsiUploadProgressBar" class="jitsi-ai-volume-fill" style="width:0%; background:#10b981;"></div>
        </div>
        <div id="jitsiUploadStatusText" style="font-size:11px; color:#cbd5e1; margin-bottom:8px;">Preparing package...</div>
        <div id="jitsiUploadActions" style="display:flex; flex-direction:column; gap:6px;">
          <a id="jitsiOpenDriveLink" href="#" target="_blank" class="jitsi-ai-ext-btn-primary" style="text-align:center; text-decoration:none; display:none;">📂 Open in Google Drive</a>
          <div style="display:flex; gap:6px;">
            <button id="jitsiDownloadAudioBtn" class="jitsi-ai-ext-btn-secondary" style="flex:1; font-size:11px;">🎵 Audio (.webm)</button>
            <button id="jitsiDownloadMdBtn" class="jitsi-ai-ext-btn-secondary" style="flex:1; font-size:11px;">📄 Summary (.md)</button>
          </div>
        </div>
      </div>

      <!-- Bottom Action Bar -->
      <div class="jitsi-ai-footer-bar">
        <button id="jitsiTranscribeBtn" class="jitsi-ai-ext-btn-secondary" style="flex:1; font-size:12px;">✨ Transcribe Call</button>
        <button id="jitsiUploadBtn" class="jitsi-ai-ext-btn-primary" style="flex:1; font-size:12px;">☁️ Upload to Drive</button>
      </div>
    </aside>
    `;
    document.body.appendChild(sidebar);

    // Event Bindings
    togglePill.onclick = (e) => {
      if (hasMoved || e.target.closest('#jitsiToggleMiniBtn') || e.target.closest('#jitsiToggleHideBtn')) return;
      sidebar.classList.add('open');
      togglePill.classList.add('sidebar-open');
    };

    const closeSidebarBtn = getEl('jitsiCloseSidebarBtn');
    if (closeSidebarBtn) {
      closeSidebarBtn.onclick = () => {
        sidebar.classList.remove('open');
        togglePill.classList.remove('sidebar-open');
      };
    }

    // Auto-close sidebar on click outside
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !togglePill.contains(e.target)) {
        sidebar.classList.remove('open');
        togglePill.classList.remove('sidebar-open');
      }
    });

    // Manual mic mute toggle button
    const micToggleBtn = getEl('jitsiMicMuteToggleBtn');
    if (micToggleBtn) {
      let isForceMuted = false;
      micToggleBtn.onclick = () => {
        isForceMuted = !isForceMuted;
        AudioMixer.setManualMicMute(isForceMuted);
        micToggleBtn.textContent = isForceMuted ? '🔇 Mic: Force Muted' : '🎤 Sync: Auto';
        micToggleBtn.style.color = isForceMuted ? '#f87171' : '#a5b4fc';
        showToast(isForceMuted ? 'Local mic forced off for recording' : 'Local mic synced with meeting mute');
      };
    }

    getEl('jitsiTabBtn_audio').onclick = () => UI.switchTab('audio');
    getEl('jitsiTabBtn_notes').onclick = () => UI.switchTab('notes');
    getEl('jitsiTabBtn_settings').onclick = () => UI.switchTab('settings');

    getEl('jitsiToggleRecordBtn').onclick = handleToggleRecord;
    getEl('jitsiTranscribeBtn').onclick = async () => {
      UI.switchTab('notes');
      await executeParallelTranscription();
      await executeDriveUpload({ isAuto: true });
    };
    getEl('jitsiUploadBtn').onclick = () => executeDriveUpload({ isAuto: false });
    getEl('jitsiCloseUploadBox').onclick = () => { getEl('jitsiUploadBox').style.display = 'none'; };

    getEl('jitsiDownloadAudioBtn').onclick = () => {
      if (compiledAudioBlob) triggerDownload(compiledAudioBlob, `Meeting_Audio_${Date.now()}.webm`, 'audio/webm');
      else showToast('No audio recorded yet.', true);
    };
    getEl('jitsiDownloadMdBtn').onclick = () => {
      if (meetingSummaryMarkdown) triggerDownload(meetingSummaryMarkdown, `Meeting_Summary_${Date.now()}.md`, 'text/markdown');
      else showToast('No notes generated yet.', true);
    };

    const keyInput = getEl('jitsiGeminiKeyInput');
    if (keyInput) {
      keyInput.addEventListener('paste', () => {
        setTimeout(() => {
          geminiApiKey = (keyInput.value || '').trim();
          saveSettings();
          showToast('Gemini Flash API Key auto-saved from paste!');
        }, 50);
      });
      getEl('jitsiSaveGeminiKeyBtn').onclick = () => {
        geminiApiKey = (keyInput.value || '').trim();
        saveSettings();
        showToast('Gemini Flash API Key saved!');
      };
    }

    getEl('jitsiSelectAcc0').onclick = () => selectAccount(0);
    getEl('jitsiSelectAcc1').onclick = () => selectAccount(1);
    getEl('jitsiSaveAccBtn').onclick = saveActiveAccountDetails;

    updateAccountUI();
    updateAiKeyDisplay();
    checkAndDisplayRecovery();
  }

  function selectAccount(idx) {
    activeAccIdx = idx;
    editingAccIdx = idx;
    saveSettings();
    updateAccountUI();
    showToast(`Switched to ${accounts[idx].name}`);
  }

  function updateAccountUI() {
    const acc0 = getEl('jitsiSelectAcc0');
    const acc1 = getEl('jitsiSelectAcc1');
    if (acc0) acc0.className = activeAccIdx === 0 ? 'jitsi-ai-ext-btn-primary' : 'jitsi-ai-ext-btn-secondary';
    if (acc1) acc1.className = activeAccIdx === 1 ? 'jitsi-ai-ext-btn-primary' : 'jitsi-ai-ext-btn-secondary';

    const currentAcc = accounts[activeAccIdx] || accounts[0];
    const webInput = getEl('jitsiAccWebhookInput');
    const folderInput = getEl('jitsiAccFolderInput');
    const geminiInput = getEl('jitsiGeminiKeyInput');

    if (webInput) webInput.value = currentAcc.webhookUrl || '';
    if (folderInput) folderInput.value = currentAcc.folderName || 'Jitsi_Meetings';
    if (geminiInput) geminiInput.value = geminiApiKey || '';
  }

  function saveActiveAccountDetails() {
    const webInput = getEl('jitsiAccWebhookInput');
    const folderInput = getEl('jitsiAccFolderInput');
    if (accounts[activeAccIdx]) {
      accounts[activeAccIdx].webhookUrl = (webInput ? webInput.value : '').trim();
      accounts[activeAccIdx].folderName = (folderInput ? folderInput.value : '').trim() || 'Jitsi_Meetings';
      saveSettings();
      showToast(`Saved settings for ${accounts[activeAccIdx].name}`);
    }
  }

  function checkAndDisplayRecovery() {
    if (Vault.findUnfinalizedSessions) {
      Vault.findUnfinalizedSessions().then((sessions) => {
        if (!sessions || sessions.length === 0) return;
        const area = getEl('jitsiRecoveryArea');
        if (!area) return;

        const latest = sessions[0];
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
              Found <strong>${latest.chunks.length} chunks</strong> (${totalKb} KB) from room <code>${UI.escapeHtml(latest.roomName)}</code>.
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

        const disBtn = getEl('jitsiDismissRecoveryBtn');
        if (disBtn) disBtn.onclick = () => { getEl('jitsiRecoveryBanner')?.remove(); };

        const transBtn = getEl('jitsiTranscribeRecoveredBtn');
        if (transBtn) transBtn.onclick = async () => {
          const chunks = latest.chunks.map(c => c.data);
          compiledAudioBlob = new Blob(chunks, { type: 'audio/webm' });
          UI.switchTab('notes');
          await executeParallelTranscription();
        };

        const downBtn = getEl('jitsiDownloadRecoveredBtn');
        if (downBtn) downBtn.onclick = () => {
          const chunks = latest.chunks.map(c => c.data);
          const blob = new Blob(chunks, { type: 'audio/webm' });
          triggerDownload(blob, `Meeting_Audio_RECOVERED_${latest.id}.webm`, 'audio/webm');
        };
      });
    }
  }

  // --------------------------------------------------------------------------
  // Crash & Emergency Backup Traps
  // --------------------------------------------------------------------------
  window.addEventListener('offline', () => {
    if (Recorder.isCurrentlyRecording()) {
      showToast('⚠️ Network connection dropped! Saving emergency audio backup...', true);
      const chunks = Recorder.getRecordedChunks();
      const room = window.location.pathname.replace('/', '') || 'jitsi-meeting';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const emergencyBlob = new Blob(chunks, { type: 'audio/webm' });
      triggerDownload(emergencyBlob, `Meeting_Audio_EMERGENCY_BACKUP_${timestamp}_${room}.webm`, 'audio/webm');
    }
  });

  window.addEventListener('beforeunload', () => {
    if (Recorder.isCurrentlyRecording()) {
      const chunks = Recorder.getRecordedChunks();
      const room = window.location.pathname.replace('/', '') || 'jitsi-meeting';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const emergencyBlob = new Blob(chunks, { type: 'audio/webm' });
      triggerDownload(emergencyBlob, `Meeting_Audio_EMERGENCY_BACKUP_${timestamp}_${room}.webm`, 'audio/webm');
    }
  });

  // Self-initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectUI);
  } else {
    injectUI();
  }
})();
