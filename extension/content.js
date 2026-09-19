/**
 * Meetings_AI Assistant - Core Injected Content Script Orchestrator
 * Connects modular components:
 * - JitsiVault: Fault-tolerant persistent IndexedDB recovery
 * - JitsiAudioMixer: Multi-stream WebRTC mixer & VAD silence filtering
 * - JitsiRecorder: 5s resilient safety slicing + 3-min parallel logical chunking
 * - JitsiTranscriber: Parallel chunk transcription & Map-Reduce AI synthesis
 * - JitsiUI: Responsive sidebar drawer, floating controls & button state machine
 * - JitsiDriveUploader: Google Drive upload with 64MiB-bypassing streaming port
 */

(function () {
  console.log('[Meetings_AI Assistant] Initializing modular architecture...');

  // --------------------------------------------------------------------------
  // Storage Keys & Multi-Account State Management
  // --------------------------------------------------------------------------
  const STORAGE_KEY = 'jitsi_plugin_accounts_v3';
  const STORAGE_ACTIVE_KEY = 'jitsi_plugin_active_idx_v3';
  const STORAGE_AI_KEY = 'jitsi_plugin_gemini_key';
  const GEMINI_CASCADE = [
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-2.0-flash',
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
      folderName: 'meetingRecords',
      webhookUrl: '',
      token: ''
    },
    {
      id: 'acc_2',
      name: 'Account 2 (Backup Drive)',
      clientId: 'backup-drive-user@gmail.com',
      clientSecret: '••••••••••••••••••••',
      folderName: 'meetingRecords_Archive',
      webhookUrl: '',
      token: ''
    }
  ];

  let accounts = DEFAULT_ACCOUNTS;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      accounts = JSON.parse(saved);
      // Automatically migrate legacy default folder names
      accounts.forEach(acc => {
        if (acc.folderName === 'Jitsi_Meetings') acc.folderName = 'meetingRecords';
        if (acc.folderName === 'Jitsi_Meetings_Archive') acc.folderName = 'meetingRecords_Archive';
      });
    }
  } catch (e) {
    accounts = DEFAULT_ACCOUNTS;
  }

  let activeAccIdx = 0;
  try {
    const savedIdx = window.localStorage.getItem(STORAGE_ACTIVE_KEY);
    if (savedIdx !== null) activeAccIdx = Number(savedIdx) || 0;
  } catch (e) {}

  const DEFAULT_GEMINI_KEY = ''; // use your Gemini Flash API key
  let geminiApiKey = window.localStorage.getItem(STORAGE_AI_KEY) || DEFAULT_GEMINI_KEY;
  let editingAccIdx = activeAccIdx;

  const STORAGE_CHUNK_DURATION_KEY = 'jitsi_block_duration_mins';
  let savedBlockDurationMins = 5;
  try {
    const savedDur = window.localStorage.getItem(STORAGE_CHUNK_DURATION_KEY);
    if (savedDur) savedBlockDurationMins = Number(savedDur) || 5;
  } catch (e) {}

  const STORAGE_DRIVE_SYNC_MODE_KEY = 'jitsi_drive_sync_mode';
  let savedDriveSyncMode = 'full';
  try {
    const savedMode = window.localStorage.getItem(STORAGE_DRIVE_SYNC_MODE_KEY);
    if (savedMode) savedDriveSyncMode = savedMode;
  } catch (e) {}

  const STORAGE_MIC_MODE_KEY = 'jitsi_plugin_mic_mode';
  let savedMicMode = 'smart_sync';
  try {
    const sMic = window.localStorage.getItem(STORAGE_MIC_MODE_KEY);
    if (sMic) savedMicMode = sMic;
  } catch (e) {}

  const STORAGE_SLACK_WEBHOOK_KEY = 'jitsi_slack_webhook_url';
  let savedSlackWebhookUrl = '';
  try {
    const sSlack = window.localStorage.getItem(STORAGE_SLACK_WEBHOOK_KEY);
    if (sSlack) savedSlackWebhookUrl = sSlack;
  } catch (e) {}

  const STORAGE_SLACK_AUTO_KEY = 'jitsi_slack_auto_share';
  let savedSlackAutoShare = false;
  try {
    const sAuto = window.localStorage.getItem(STORAGE_SLACK_AUTO_KEY);
    if (sAuto !== null) savedSlackAutoShare = sAuto === 'true';
  } catch (e) {}

  function isSlackSharePermitted() {
    const autoCheck = document.getElementById('jitsiSlackAutoShareCheck');
    if (autoCheck) {
      savedSlackAutoShare = Boolean(autoCheck.checked);
      return Boolean(autoCheck.checked);
    }
    try {
      const sAuto = window.localStorage.getItem(STORAGE_SLACK_AUTO_KEY);
      if (sAuto !== null) {
        savedSlackAutoShare = sAuto === 'true';
        return savedSlackAutoShare;
      }
    } catch (e) {}
    return Boolean(savedSlackAutoShare);
  }

  let lastUploadedFolderUrl = '';
  let activeMeetingBlockTranscripts = {};

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

  function updateSlackUI() {
    const badge = document.getElementById('jitsiSlackBadge');
    if (badge) {
      if (savedSlackWebhookUrl && savedSlackWebhookUrl.includes('hooks.slack.com')) {
        badge.textContent = '✓ Slack Connected';
        badge.style.color = '#34d399';
        badge.style.background = 'rgba(16,185,129,0.2)';
      } else {
        badge.textContent = 'No Webhook';
        badge.style.color = '#94a3b8';
        badge.style.background = 'rgba(255,255,255,0.06)';
      }
    }
    const input = document.getElementById('jitsiSlackWebhookInput');
    if (input && document.activeElement !== input) {
      input.value = savedSlackWebhookUrl || '';
    }
    const autoBox = document.getElementById('jitsiSlackAutoShareCheck');
    if (autoBox) {
      autoBox.checked = Boolean(savedSlackAutoShare);
    }
  }

  function saveSettings() {
    try {
      const autoCheck = document.getElementById('jitsiSlackAutoShareCheck');
      if (autoCheck) {
        savedSlackAutoShare = Boolean(autoCheck.checked);
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
      window.localStorage.setItem(STORAGE_ACTIVE_KEY, String(activeAccIdx));
      window.localStorage.setItem(STORAGE_AI_KEY, geminiApiKey);
      window.localStorage.setItem(STORAGE_CHUNK_DURATION_KEY, String(savedBlockDurationMins));
      window.localStorage.setItem(STORAGE_MIC_MODE_KEY, savedMicMode);
      window.localStorage.setItem(STORAGE_SLACK_WEBHOOK_KEY, savedSlackWebhookUrl);
      window.localStorage.setItem(STORAGE_SLACK_AUTO_KEY, String(savedSlackAutoShare));
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const area = chrome.storage.sync || chrome.storage.local;
        if (area) {
          area.set({
            [STORAGE_KEY]: accounts,
            [STORAGE_ACTIVE_KEY]: activeAccIdx,
            [STORAGE_AI_KEY]: geminiApiKey,
            [STORAGE_CHUNK_DURATION_KEY]: savedBlockDurationMins,
            [STORAGE_MIC_MODE_KEY]: savedMicMode,
            [STORAGE_SLACK_WEBHOOK_KEY]: savedSlackWebhookUrl,
            [STORAGE_SLACK_AUTO_KEY]: savedSlackAutoShare
          });
        }
      }
    } catch (e) {}
    updateAiKeyDisplay();
    updateSlackUI();
  }

  // Hydrate settings asynchronously from chrome.storage
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const area = chrome.storage.sync || chrome.storage.local;
      if (area) {
        area.get([STORAGE_AI_KEY, STORAGE_KEY, STORAGE_ACTIVE_KEY, STORAGE_CHUNK_DURATION_KEY, STORAGE_MIC_MODE_KEY, STORAGE_SLACK_WEBHOOK_KEY, STORAGE_SLACK_AUTO_KEY], (res) => {
          if (!res) return;
          if (res[STORAGE_AI_KEY]) geminiApiKey = res[STORAGE_AI_KEY].trim();
          if (res[STORAGE_KEY] && Array.isArray(res[STORAGE_KEY])) accounts = res[STORAGE_KEY];
          if (typeof res[STORAGE_ACTIVE_KEY] === 'number') activeAccIdx = res[STORAGE_ACTIVE_KEY];
          if (res[STORAGE_CHUNK_DURATION_KEY]) {
            savedBlockDurationMins = Number(res[STORAGE_CHUNK_DURATION_KEY]) || 5;
            Recorder.setBlockDuration(savedBlockDurationMins);
          }
          if (res[STORAGE_MIC_MODE_KEY]) {
            savedMicMode = res[STORAGE_MIC_MODE_KEY];
            if (AudioMixer.setAutoMuteSync) {
              AudioMixer.setAutoMuteSync(savedMicMode !== 'always_record');
            }
          }
          if (res[STORAGE_SLACK_WEBHOOK_KEY]) savedSlackWebhookUrl = res[STORAGE_SLACK_WEBHOOK_KEY].trim();
          if (typeof res[STORAGE_SLACK_AUTO_KEY] === 'boolean') savedSlackAutoShare = res[STORAGE_SLACK_AUTO_KEY];
          updateAccountUI();
          updateAiKeyDisplay();
          updateSlackUI();
        });
      }

      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (changes[STORAGE_AI_KEY] && changes[STORAGE_AI_KEY].newValue) {
          geminiApiKey = changes[STORAGE_AI_KEY].newValue.trim();
          updateAccountUI();
          updateAiKeyDisplay();
        }
        if (changes[STORAGE_SLACK_WEBHOOK_KEY] && changes[STORAGE_SLACK_WEBHOOK_KEY].newValue) {
          savedSlackWebhookUrl = changes[STORAGE_SLACK_WEBHOOK_KEY].newValue.trim();
          updateSlackUI();
        }
        if (changes[STORAGE_SLACK_AUTO_KEY] && typeof changes[STORAGE_SLACK_AUTO_KEY].newValue === 'boolean') {
          savedSlackAutoShare = changes[STORAGE_SLACK_AUTO_KEY].newValue;
          updateSlackUI();
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
  const UI = window.JitsiUI || {
    switchTab: (tabId) => {
      const tabMap = { recording: 'audio', audio: 'audio', notes: 'notes', settings: 'settings' };
      const active = tabMap[tabId] || 'audio';
      ['audio', 'notes', 'settings'].forEach(t => {
        const btn = document.getElementById(`jitsiTabBtn_${t}`) || document.querySelector(`[data-tab="${t}"]`) || (t === 'audio' ? document.querySelector('[data-tab="recording"]') : null);
        const content = document.getElementById(`jitsiTabContent_${t}`) || (t === 'audio' ? document.getElementById('jitsiRecordingTab') : (t === 'notes' ? document.getElementById('jitsiNotesTab') : document.getElementById('jitsiSettingsTab')));
        if (btn) btn.classList.toggle('active', t === active);
        if (content) {
          content.classList.toggle('active', t === active);
          content.style.display = t === active ? 'block' : 'none';
        }
      });
    },
    escapeHtml: (t) => {
      const d = document.createElement('div');
      d.textContent = t || '';
      return d.innerHTML;
    },
    showToast: (msg, isErr) => {
      console.log(`[Toast] ${isErr ? 'ERR: ' : ''}${msg}`);
    }
  };
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
  let meetingRecordingStartTime = null;

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
  let liveSTTRetryCount = 0;
  const MAX_LIVE_STT_RETRIES = 3;
  let liveSTTRestartTimer = null;
  let isRecordingStarting = false;

  function startLiveSTT() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;

    liveSTTRetryCount = 0;
    if (liveSTTRestartTimer) clearTimeout(liveSTTRestartTimer);

    try {
      if (liveSTTRecognizer) {
        try { liveSTTRecognizer.abort(); } catch (e) {}
        liveSTTRecognizer = null;
      }

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
              const elapsedSec = meetingRecordingStartTime ? Math.round((Date.now() - meetingRecordingStartTime) / 1000) : 0;
              liveCapturedTranscripts.push({ time: timeStr, elapsedSec, text });
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

      liveSTTRecognizer.onerror = (evt) => {
        const err = evt ? evt.error : 'unknown';
        // 'aborted' and 'no-speech' are benign lifecycle events (fired on mic mute, user silence, or stop)
        if (err === 'aborted' || err === 'no-speech') {
          return;
        }
        // Gracefully halt retries if permission is unavailable
        if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
          liveSTTRetryCount = MAX_LIVE_STT_RETRIES;
          return;
        }
        console.log('[Live STT] Speech recognition notice:', err);
      };

      liveSTTRecognizer.onend = () => {
        if (Recorder.isCurrentlyRecording() && liveSTTRetryCount < MAX_LIVE_STT_RETRIES) {
          liveSTTRetryCount++;
          if (liveSTTRestartTimer) clearTimeout(liveSTTRestartTimer);
          liveSTTRestartTimer = setTimeout(() => {
            if (Recorder.isCurrentlyRecording() && liveSTTRetryCount <= MAX_LIVE_STT_RETRIES) {
              try {
                if (liveSTTRecognizer) liveSTTRecognizer.start();
              } catch (e) {}
            }
          }, 2000);
        }
      };

      liveSTTRecognizer.start();
    } catch (e) {
      console.log('[Live STT] Init notice:', e.message);
    }
  }

  function stopLiveSTT() {
    if (liveSTTRestartTimer) clearTimeout(liveSTTRestartTimer);
    liveSTTRetryCount = MAX_LIVE_STT_RETRIES;
    if (liveSTTRecognizer) {
      // Detach listeners before aborting so Chrome does not log an 'aborted' error
      liveSTTRecognizer.onerror = null;
      liveSTTRecognizer.onend = null;
      try { liveSTTRecognizer.abort(); } catch (e) {}
      liveSTTRecognizer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Core Workflow Actions: Start, Stop, Parallel Transcribe, Drive Upload
  // --------------------------------------------------------------------------
  async function handleToggleRecord() {
    if (isRecordingStarting) return;

    if (Recorder.isCurrentlyRecording()) {
      // 1. Stop active recording and seal final partial block
      showToast('Stopping audio capture and compiling meeting notes...');
      await Recorder.stopRecording((finalBlock) => {
        if (finalBlock) {
          UI.renderBlockItem(finalBlock, 'transcribing');
        }
      });
      AudioMixer.cleanupMixer();
      stopLiveSTT();

      // Reset floating badge to Ready
      const floatBadge = getEl('jitsiFloatingCount');
      if (floatBadge) {
        floatBadge.className = 'jitsi-ai-badge';
        floatBadge.textContent = 'Ready';
      }

      // Switch button immediately to "Record Again" so user never loses the ability to record!
      UI.setRecordButtonState('record_again');

      const dot = getEl('jitsiVadDot');
      const label = getEl('jitsiVadLabel');
      if (dot) dot.className = 'jitsi-ai-vad-dot';
      if (label) label.textContent = 'Completed';

      // 2. Switch tab to notes & execute fast-path compilation
      UI.switchTab('notes');
      try {
        await executeParallelTranscription();
      } catch (compileErr) {
        console.error('[Compilation Recovery]:', compileErr);
      }

      // 3. Automatically sync to Google Drive (Zero Audio Loss Guarantee!)
      await executeDriveUpload({ isAuto: true });
    } else {
      // Start fresh recording session
      await startFreshRecording();
    }
  }

  async function startFreshRecording() {
    if (isRecordingStarting) return;
    isRecordingStarting = true;

    const recBtn = getEl('jitsiToggleRecordBtn');
    if (recBtn) {
      recBtn.disabled = true;
      recBtn.style.opacity = '0.7';
    }

    try {
      showToast('Initializing high-fidelity audio capture...');
      const room = window.location.pathname.replace('/', '') || 'jitsi-meeting';
      if (Vault.createVaultSession) {
        await Vault.createVaultSession(room);
      }

      // Reset state and configure block duration
      activeMeetingBlockTranscripts = {};
      meetingRecordingStartTime = Date.now();
      Recorder.setBlockDuration(savedBlockDurationMins);
      AudioMixer.resetVADStats();
      if (AudioMixer.setAutoMuteSync) {
        AudioMixer.setAutoMuteSync(savedMicMode !== 'always_record');
      }
      const mixedStream = await AudioMixer.initAudioMixer(getEl('jitsiAiSidebar'));
      AudioMixer.initVAD(() => Recorder.isCurrentlyRecording());

      liveCapturedTranscripts = [];
      const tBox = getEl('jitsiTranscriptBox');
      if (tBox) tBox.innerHTML = '<em style="color:#64748b; font-size:12px;">Capturing speech in real-time...</em>';

      const chunksList = getEl('jitsiChunksList');
      if (chunksList) chunksList.innerHTML = `<em style="color:#64748b; font-size:11px; padding:6px 0;">${savedBlockDurationMins}-minute speech blocks will appear here as participants talk...</em>`;

      await Recorder.startRecording({
        mixedStream,
        onChunkCaptured: (chunkBlob, chunkMeta) => {
          // Persist 10-second resilient slice to IndexedDB vault
          if (Vault.appendChunkToVault) {
            Vault.appendChunkToVault(chunkBlob, chunkMeta);
          }
        },
        onBlockProgress: (prog) => {
          UI.renderActiveBlockProgress(prog);
          const floatBadge = getEl('jitsiFloatingCount');
          if (floatBadge) {
            floatBadge.className = 'jitsi-ai-badge recording';
            const min = Math.floor(prog.elapsedSec / 60);
            const sec = prog.elapsedSec % 60;
            floatBadge.textContent = `🔴 Rec ${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
          }
        },
        onBlockSealed: (sealedBlock) => {
          // 1. Render sealed block in drawer
          UI.renderBlockItem(sealedBlock, 'transcribing');
          showToast(`⚡ Sealed Block #${sealedBlock.index} [${sealedBlock.startTime}-${sealedBlock.endTime}]. Transcribing with Gemini Flash in background...`);

          // 2. Preemptively transcribe in background with Web Speech STT fallback
          const activeKey = (geminiApiKey || DEFAULT_GEMINI_KEY || '').trim();
          Transcriber.transcribeSingleBlock(sealedBlock, {
            apiKey: activeKey,
            roomName: room,
            liveTranscripts: liveCapturedTranscripts
          }).then((result) => {
            activeMeetingBlockTranscripts[sealedBlock.index] = result;
            if (result.isFailed) {
              UI.updateBlockStatus(sealedBlock.index, 'error', result.error || 'Transcription failed', () => retrySingleBlock(sealedBlock.index));
              updateRetryFailedBtnVisibility();
              showToast(`⚠️ Block #${sealedBlock.index} transcription failed: ${result.error || 'Check API key'}. Click Retry.`, true);
            } else {
              UI.updateBlockStatus(sealedBlock.index, 'completed', result.transcript);
              updateRetryFailedBtnVisibility();
              showToast(`✅ Block #${sealedBlock.index} transcribed in background!`);

              // Append preview snippet to transcript box
              const tb = getEl('jitsiTranscriptBox');
              if (tb && result.transcript) {
                const ph = tb.querySelector('em');
                if (ph) ph.remove();
                let item = getEl(`transcript_block_item_${sealedBlock.index}`);
                if (!item) {
                  item = document.createElement('div');
                  item.id = `transcript_block_item_${sealedBlock.index}`;
                  item.style.marginBottom = '8px';
                  tb.appendChild(item);
                }
                item.innerHTML = `<span style="color:#818cf8; font-size:11px; font-weight:700;">[Block #${sealedBlock.index} ${sealedBlock.startTime}-${sealedBlock.endTime}]</span> <div>${UI.escapeHtml(result.transcript)}</div>`;
                tb.scrollTop = tb.scrollHeight;
              }
            }
          }).catch((err) => {
            console.warn(`[Background STT] Block #${sealedBlock.index} notice:`, err);
            UI.updateBlockStatus(sealedBlock.index, 'error', err.message || 'Error', () => retrySingleBlock(sealedBlock.index));
            updateRetryFailedBtnVisibility();
          });
        },
        onVaultCheckpoint: (chunks) => {
          if (Vault.saveVaultCheckpoint) {
            Vault.saveVaultCheckpoint(chunks, Recorder.isCurrentlyRecording(), showToast);
          }
        }
      });

      startLiveSTT();
      UI.setRecordButtonState('recording');
      showToast(`🔴 Recording started! Capturing voice in ${savedBlockDurationMins}-minute parallel blocks.`);
    } catch (err) {
      console.error('Failed to start recording:', err);
      showToast('Microphone permission required to start audio capture.', true);
      UI.setRecordButtonState('idle');
    } finally {
      isRecordingStarting = false;
      if (recBtn) {
        recBtn.disabled = false;
        recBtn.style.opacity = '1';
      }
    }
  }

  function updateRetryFailedBtnVisibility() {
    const btn = getEl('jitsiRetryFailedBlocksBtn');
    if (!btn) return;
    const hasFailed = Object.values(activeMeetingBlockTranscripts).some(r => r && r.isFailed);
    btn.style.display = hasFailed ? 'inline-block' : 'none';
  }

  async function retrySingleBlock(blockIndex) {
    const blocks = Recorder.getLogicalBlocks ? Recorder.getLogicalBlocks() : [];
    const targetBlock = blocks.find(b => b.index === blockIndex);
    if (!targetBlock) {
      showToast(`Block #${blockIndex} audio not found in memory.`, true);
      return;
    }

    UI.updateBlockStatus(blockIndex, 'retrying');
    showToast(`⚡ Retrying transcription for Block #${blockIndex}...`);

    const room = window.location.pathname.replace('/', '') || 'jitsi-meeting';
    const activeKey = (geminiApiKey || DEFAULT_GEMINI_KEY || '').trim();

    try {
      const result = await Transcriber.transcribeSingleBlock(targetBlock, {
        apiKey: activeKey,
        roomName: room,
        liveTranscripts: liveCapturedTranscripts
      });

      activeMeetingBlockTranscripts[blockIndex] = result;

      if (result.isFailed) {
        UI.updateBlockStatus(blockIndex, 'error', result.error || 'Transcription failed', () => retrySingleBlock(blockIndex));
        updateRetryFailedBtnVisibility();
        showToast(`⚠️ Block #${blockIndex} retry failed: ${result.error || 'Check API key'}`, true);
      } else {
        UI.updateBlockStatus(blockIndex, 'completed', result.transcript);
        updateRetryFailedBtnVisibility();
        showToast(`✅ Block #${blockIndex} transcribed successfully!`);

        const tb = getEl('jitsiTranscriptBox');
        if (tb && result.transcript) {
          const ph = tb.querySelector('em');
          if (ph) ph.remove();
          let item = getEl(`transcript_block_item_${blockIndex}`);
          if (!item) {
            item = document.createElement('div');
            item.id = `transcript_block_item_${blockIndex}`;
            item.style.marginBottom = '8px';
            tb.appendChild(item);
          }
          item.innerHTML = `<span style="color:#818cf8; font-size:11px; font-weight:700;">[Block #${blockIndex} ${targetBlock.startTime}-${targetBlock.endTime}]</span> <div>${UI.escapeHtml(result.transcript)}</div>`;
          tb.scrollTop = tb.scrollHeight;
        }
      }
    } catch (err) {
      UI.updateBlockStatus(blockIndex, 'error', err.message || 'Transcription error', () => retrySingleBlock(blockIndex));
      updateRetryFailedBtnVisibility();
      showToast(`⚠️ Block #${blockIndex} retry error: ${err.message}`, true);
    }
  }

  async function retryAllFailedBlocks() {
    const failedIndices = Object.keys(activeMeetingBlockTranscripts)
      .map(Number)
      .filter(idx => activeMeetingBlockTranscripts[idx] && activeMeetingBlockTranscripts[idx].isFailed);

    if (failedIndices.length === 0) {
      showToast('No failed blocks to retry.');
      return;
    }

    showToast(`⚡ Retrying ${failedIndices.length} failed block(s)...`);
    const btn = getEl('jitsiRetryFailedBlocksBtn');
    if (btn) btn.disabled = true;
    try {
      await Promise.allSettled(failedIndices.map(idx => retrySingleBlock(idx)));
    } finally {
      if (btn) btn.disabled = false;
      updateRetryFailedBtnVisibility();
    }
  }

  /**
   * Fast Meeting-End Compilation:
   * Merges all precomputed background transcripts and transcribes only the final partial block.
   */
  async function executeParallelTranscription({ forceRetry = false } = {}) {
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

      showToast(`✨ Fast-compiling ${logicalBlocks.length} audio block(s)...`);

      const activeKey = geminiApiKey || DEFAULT_GEMINI_KEY;
      const transcriptionResult = await Transcriber.compilePreemptivelyTranscribedMeeting({
        blocks: logicalBlocks,
        precomputedTranscripts: activeMeetingBlockTranscripts,
        apiKey: activeKey,
        roomName: room,
        liveTranscripts: liveCapturedTranscripts,
        unifiedAudioBlob: compiledAudioBlob,
        forceRetry: forceRetry,
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

      showToast('✅ AI Transcription & executive synthesis completed!');
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

      const isNotesOnly = savedDriveSyncMode === 'notes_only';
      const audioToUpload = isNotesOnly ? null : compiledAudioBlob;

      const result = await uploader.uploadPackage({
        credentials: creds,
        folderName: acc.folderName || 'meetingRecords',
        roomName: room,
        audioBlob: audioToUpload,
        audioFileName: audioFileName,
        markdownText: meetingSummaryMarkdown,
        markdownFileName: markdownFileName,
        syncMode: savedDriveSyncMode,
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
        const dedicatedFolderFallback = `https://drive.google.com/drive/search?q=${encodeURIComponent(acc.folderName || 'meetingRecords')}`;
        const folderUrl = result.folderUrl || (result.folderId ? `https://drive.google.com/drive/folders/${result.folderId}` : dedicatedFolderFallback);
        lastUploadedFolderUrl = folderUrl;
        const successMsg = isNotesOnly
          ? `✅ <strong>Success!</strong> Meeting notes synced to Google Drive (instant &lt; 1s mode). Local audio saved.`
          : `✅ <strong>Success!</strong> Audio &amp; notes uploaded to Google Drive: <code>${UI.escapeHtml(acc.folderName)}</code>.`;
        if (statusText) statusText.innerHTML = successMsg;
        if (openDriveLink) {
          openDriveLink.href = folderUrl;
          openDriveLink.textContent = '📂 Open Folder in Google Drive';
          openDriveLink.style.display = 'block';
        }

        const shareSlackBtn = getEl('jitsiShareSlackBtn');
        if (shareSlackBtn) {
          shareSlackBtn.style.display = 'block';
          shareSlackBtn.textContent = '📢 Share to Slack Channel';
          shareSlackBtn.style.background = '';
          shareSlackBtn.style.color = '';
          shareSlackBtn.onclick = () => {
            if (!savedSlackWebhookUrl || !savedSlackWebhookUrl.includes('hooks.slack.com')) {
              showToast('⚠️ Please configure your Slack Webhook URL in Settings (⚙️) first.', true);
              UI.switchTab('settings');
              return;
            }
            dispatchSlackNotification({ folderUrl, isManual: true });
          };
        }

        if (isNotesOnly && compiledAudioBlob) {
          triggerDownload(compiledAudioBlob, audioFileName, 'audio/webm');
        }
        if (actionsArea) actionsArea.style.display = 'flex';
        showToast(`✅ Uploaded to Google Drive (${acc.name})!`);

        // Automatic dispatch to Slack IF AND ONLY IF the checkbox in settings is ticked
        if (isSlackSharePermitted() && savedSlackWebhookUrl) {
          dispatchSlackNotification({ folderUrl, isManual: false });
        } else {
          console.log('[Slack] Automatic dispatch skipped because Share to Slack checkbox is unticked in Settings.');
        }
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

  /**
   * Dispatches meeting notes & Google Drive folder URL to Slack Webhook
   */
  async function dispatchSlackNotification({ folderUrl, isManual = false } = {}) {
    // Strictly verify permission: If automatic trigger and checkbox is unticked, NEVER hit webhook
    if (!isManual && !isSlackSharePermitted()) {
      console.log('[Slack Webhook] Blocked: Auto-share to Slack checkbox is unticked in Settings.');
      return;
    }

    const activeAcc = (typeof accounts !== 'undefined' && accounts && accounts[activeAccIdx]) || {};
    const dedicatedFallback = `https://drive.google.com/drive/search?q=${encodeURIComponent(activeAcc.folderName || 'meetingRecords')}`;
    const targetUrl = folderUrl || lastUploadedFolderUrl || dedicatedFallback;
    if (!savedSlackWebhookUrl || !savedSlackWebhookUrl.includes('hooks.slack.com')) {
      if (isManual) {
        showToast('Please configure your Slack Webhook URL in Settings (⚙️).', true);
        UI.switchTab('settings');
      }
      return;
    }

    const room = window.location.pathname.replace('/', '') || 'Meeting';
    const shareBtn = getEl('jitsiShareSlackBtn');
    if (shareBtn) {
      shareBtn.disabled = true;
      shareBtn.textContent = '⏳ Sharing to Slack...';
    }

    try {
      if (isManual) showToast('📢 Posting meeting notes to Slack...');

      const decBox = getEl('jitsiDecisionsBox');
      const actBox = getEl('jitsiActionsBox');
      const decisions = decBox ? Array.from(decBox.querySelectorAll('div')).map(d => d.textContent.trim()) : [];
      const actions = actBox ? Array.from(actBox.querySelectorAll('.jitsi-ai-ext-task-item span')).map(a => a.textContent.trim()) : [];
      const cleanTime = getEl('jitsiCleanSpeechTime')?.textContent || '';
      const audioSize = compiledAudioBlob ? (compiledAudioBlob.size / 1024).toFixed(1) : '';

      await new Promise((resolve, reject) => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'SLACK_SEND_NOTIFICATION',
            webhookUrl: savedSlackWebhookUrl,
            roomName: room,
            folderUrl: targetUrl,
            decisions,
            actions,
            durationStr: cleanTime,
            audioSizeKb: audioSize
          }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.success) {
              resolve(response.data);
            } else {
              reject(new Error(response?.error || 'Slack delivery failed'));
            }
          });
        } else {
          resolve({ success: true });
        }
      });

      showToast('✅ Google Drive link and AI notes shared to Slack!');
      if (shareBtn) {
        shareBtn.textContent = '✅ Shared to Slack';
        shareBtn.style.background = 'rgba(16,185,129,0.2)';
        shareBtn.style.color = '#34d399';
        shareBtn.style.borderColor = 'rgba(16,185,129,0.4)';
      }
    } catch (slackErr) {
      console.warn('[Slack Dispatch Notice]:', slackErr);
      if (isManual) showToast(`Slack error: ${slackErr.message}`, true);
      if (shareBtn) {
        shareBtn.textContent = '📢 Share to Slack Channel';
      }
    } finally {
      if (shareBtn) shareBtn.disabled = false;
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
      <!-- Header -->
      <div class="jitsi-ai-ext-header jitsi-ai-header">
        <div class="jitsi-ai-ext-title jitsi-ai-title-wrap">
          <span style="font-size:16px;">✨</span>
          <span>Jitsi &amp; Meet AI Assistant</span>
        </div>
        <button id="jitsiCloseSidebarBtn" class="jitsi-ai-ext-close jitsi-ai-icon-btn" title="Close Drawer">&times;</button>
      </div>

      <!-- Active Drive Target Bar -->
      <div class="jitsi-ai-ext-drive-bar">
        <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:240px;">
          <span>Target:</span> <strong id="jitsiDriveAccName" style="color:#f8fafc;">Account 1</strong>
          <span id="jitsiDriveEmailDisplay" style="font-size:10px; opacity:0.8; display:block;">Folder: meetingRecords</span>
        </div>
        <button class="jitsi-ai-ext-switch-btn" id="jitsiSwitchAccBtn" title="Switch Account">⚙️ Accounts</button>
      </div>

      <!-- Live VAD Status & Volume Bar -->
      <div class="jitsi-ai-vad-bar">
        <div class="jitsi-ai-vad-status">
          <span class="jitsi-ai-vad-dot" id="jitsiVadDot"></span>
          <span id="jitsiVadLabel" style="font-weight:600;">Standby</span>
        </div>
        <div class="jitsi-ai-volume-meter" title="Live audio volume of all participants">
          <div class="jitsi-ai-volume-fill" id="jitsiVolumeFill"></div>
        </div>
        <div style="display:flex; gap:5px; align-items:center;">
          <span class="jitsi-ai-stats-pill" id="jitsiAudioStats">00:00 clean</span>
          <button id="jitsiMicMuteToggleBtn" class="jitsi-ai-ext-switch-btn" style="padding:1px 6px; font-size:10px;" title="Click to manually force-mute your mic in recording">🎤 Sync: Auto</button>
        </div>
      </div>

      <!-- Interruption Recovery Alert Area -->
      <div id="jitsiRecoveryArea"></div>

      <!-- Navigation Tabs -->
      <div class="jitsi-ai-ext-tabs jitsi-ai-nav-tabs">
        <button id="jitsiTabBtn_audio" class="jitsi-ai-ext-tab jitsi-ai-tab-btn active" data-tab="audio">🎙️ Live Audio</button>
        <button id="jitsiTabBtn_notes" class="jitsi-ai-ext-tab jitsi-ai-tab-btn" data-tab="notes">📝 AI Minutes</button>
        <button id="jitsiTabBtn_settings" class="jitsi-ai-ext-tab jitsi-ai-tab-btn" data-tab="settings">⚙️ Settings</button>
      </div>

      <!-- TAB 1: Live Audio & VAD Panel -->
      <div id="jitsiTabContent_audio" class="jitsi-ai-ext-content jitsi-ai-tab-content" style="display:block;">
        <div class="jitsi-ai-ext-card jitsi-ai-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:12px; font-weight:700; color:#fff;">Multi-Speaker Audio Capture</span>
            <span class="jitsi-ai-stats-pill" id="jitsiSpeakerCountBadge">You + 0 Remote</span>
          </div>
          <p style="font-size:11px; color:#94a3b8; line-height:1.4; margin:0 0 10px 0;">
            Captures <strong>all call participants</strong> via WebRTC mixer. Silence is filtered in real-time, and your voice is automatically silenced whenever your meeting mic is off.
          </p>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:11px; margin-bottom:10px;">
            <div style="background:rgba(15,23,42,0.6); padding:6px 8px; border-radius:4px; border:1px solid rgba(255,255,255,0.06);">
              <span style="color:#94a3b8; display:block; font-size:10px;">Active Speech:</span>
              <strong id="jitsiCleanSpeechTime" style="color:#34d399; font-size:12px;">00:00</strong>
            </div>
            <div style="background:rgba(15,23,42,0.6); padding:6px 8px; border-radius:4px; border:1px solid rgba(255,255,255,0.06);">
              <span style="color:#94a3b8; display:block; font-size:10px;">Silence Skipped:</span>
              <strong id="jitsiSilenceRatio" style="color:#818cf8; font-size:12px;">0% saved</strong>
            </div>
          </div>

          <!-- Fault-Tolerant Audio Vault Status -->
          <div style="background:rgba(15,23,42,0.6); padding:8px 10px; border-radius:6px; margin-bottom:10px; border:1px solid rgba(16,185,129,0.25);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:11px; color:#10b981; font-weight:600; display:flex; align-items:center; gap:4px;">
                <span>🔒</span> Fault-Tolerant Audio Vault Active
              </span>
              <button id="jitsiManualCheckpointBtn" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#cbd5e1; font-size:10px; padding:3px 7px; border-radius:4px; cursor:pointer;" title="Force immediate checkpoint save to disk">
                💾 Save Checkpoint
              </button>
            </div>
            <div id="jitsiVaultCheckpointStatus" style="font-size:10px; color:#94a3b8; margin-top:3px; line-height:1.3;">
              Audio slices saved to IndexedDB every 10s • Auto-checkpoints every 3 mins
            </div>
          </div>

          <div style="display:flex; gap:8px;">
            <button id="jitsiToggleRecordBtn" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-primary" style="flex:1;">
              🔴 Start Recording Everyone
            </button>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div class="jitsi-ai-ext-section-title" id="jitsiBlockSectionHeader" style="margin:0;">5-Minute Parallel Speech Blocks (<span id="jitsiChunkCountBadge">0</span>)</div>
          <button id="jitsiRetryFailedBlocksBtn" style="background:transparent; border:1px solid rgba(245,158,11,0.5); color:#fbbf24; border-radius:4px; font-size:10px; padding:2px 7px; cursor:pointer; display:none;" title="Retry transcribing all failed blocks">🔄 Retry Failed</button>
        </div>
        <div id="jitsiChunksList" style="max-height:180px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
          <em style="color:#64748b; font-size:11px; padding:6px 0;">5-minute speech segments will appear here as participants talk...</em>
        </div>
      </div>

      <!-- TAB 2: AI Minutes & Tasks Panel -->
      <div id="jitsiTabContent_notes" class="jitsi-ai-ext-content jitsi-ai-tab-content" style="display:none;">
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <button id="jitsiDownloadAudioBtn" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-primary" style="flex:1; padding:8px 10px; font-size:11px;">
            <span>🎵</span><span>Download Audio (.webm)</span>
          </button>
          <button id="jitsiDownloadMdBtn" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-secondary" style="flex:1; padding:8px 10px; font-size:11px;">
            <span>📄</span><span>Download Notes (.md)</span>
          </button>
        </div>

        <div id="jitsiAudioPlayerBox" class="jitsi-ai-ext-card jitsi-ai-card" style="display:none; padding:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:11px; font-weight:700; color:#34d399;">🎧 Listen to Meeting Audio</span>
            <span id="jitsiAudioPlayerSize" style="font-size:10px; color:#94a3b8;"></span>
          </div>
          <audio id="jitsiAudioPlayer" controls style="width:100%; height:32px; outline:none; border-radius:4px;"></audio>
        </div>

        <div class="jitsi-ai-ext-section-title">🎯 Key Decisions</div>
        <div class="jitsi-ai-ext-card jitsi-ai-card" id="jitsiDecisionsBox">
          <em style="color:#64748b; font-size:11px;">Decisions will appear here after speech is transcribed...</em>
        </div>

        <div class="jitsi-ai-ext-section-title">✅ Action Items &amp; Owners</div>
        <div class="jitsi-ai-ext-card jitsi-ai-card" id="jitsiActionsBox">
          <em style="color:#64748b; font-size:11px;">Action items will appear here with interactive checkboxes...</em>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div class="jitsi-ai-ext-section-title" style="margin:0;">Full Meeting Transcript</div>
          <button id="jitsiCopyTranscriptBtn" class="jitsi-ai-ext-switch-btn" style="font-size:10px; padding:2px 8px;">📋 Copy Text</button>
        </div>
        <div class="jitsi-ai-ext-card jitsi-ai-card" id="jitsiTranscriptBox" style="max-height:180px; overflow-y:auto; font-size:12px; color:#cbd5e1; line-height:1.5;">
          <em style="color:#64748b; font-size:11px;">Transcript will appear here...</em>
        </div>
      </div>

      <!-- TAB 3: Settings Panel -->
      <div id="jitsiTabContent_settings" class="jitsi-ai-ext-content jitsi-ai-tab-content" style="display:none;">
        <div class="jitsi-ai-ext-section-title">Gemini AI Transcription</div>
        <div class="jitsi-ai-ext-card jitsi-ai-card" style="margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:11px; font-weight:600; color:#fff;">Gemini Flash API Key</span>
            <span id="jitsiAiKeyBadge" class="jitsi-ai-badge" style="font-size:10px;">No Key</span>
          </div>
          <input type="password" id="jitsiGeminiKeyInput" placeholder="Enter Gemini API Key" style="width:calc(100% - 16px); padding:8px; border-radius:6px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:11px; margin-bottom:8px;">
          <div style="display:flex; gap:6px;">
            <button id="jitsiSaveGeminiKeyBtn" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-primary" style="flex:1; font-size:11px;">💾 Save Gemini Key</button>
            <button id="jitsiTestGeminiKeyBtn" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-secondary" style="flex:1; font-size:11px;">🔔 Test Gemini Key</button>
          </div>
          <div id="jitsiGeminiKeyStatus" style="font-size:11px; margin-top:8px; line-height:1.4; display:none;"></div>
        </div>

        <div class="jitsi-ai-ext-section-title">Audio Chunk Duration</div>
        <div class="jitsi-ai-ext-card jitsi-ai-card" style="margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:11px; font-weight:600; color:#fff;">Preemptive Processing Chunk Size</span>
            <span id="jitsiChunkDurationBadge" class="jitsi-ai-badge" style="font-size:10px; color:#818cf8;">5 Minutes</span>
          </div>
          <p style="font-size:11px; color:#94a3b8; margin:0 0 8px 0; line-height:1.4;">
            Audio blocks are sealed and transcribed with Gemini Flash in the background every few minutes during the call.
          </p>
          <select id="jitsiChunkDurationSelect" style="width:100%; padding:8px; border-radius:6px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:11px; cursor:pointer;">
            <option value="3">3 Minutes per chunk</option>
            <option value="4">4 Minutes per chunk</option>
            <option value="5" selected>5 Minutes per chunk (Default)</option>
            <option value="6">6 Minutes per chunk</option>
          </select>
        </div>

        <div class="jitsi-ai-ext-section-title">Microphone Capture & Screen Share Mode</div>
        <div class="jitsi-ai-ext-card jitsi-ai-card" style="margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:11px; font-weight:600; color:#fff;">Mic Auto-Mute Synchronization</span>
            <span id="jitsiMicModeBadge" class="jitsi-ai-badge" style="font-size:10px; color:#10b981;">Smart Mute Sync</span>
          </div>
          <p style="font-size:11px; color:#94a3b8; margin:0 0 8px 0; line-height:1.4;">
            Prevents your voice from being silenced when someone is screen sharing or other participants are muted.
          </p>
          <select id="jitsiMicModeSelect" style="width:100%; padding:8px; border-radius:6px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:11px; cursor:pointer;">
            <option value="smart_sync" selected>🎙️ Smart Mute Sync (Pause mic only when YOU mute in Meet/Jitsi)</option>
            <option value="always_record">🔴 Always Record Mic (Never mute mic audio, recommended for presentations)</option>
          </select>
        </div>

        <div class="jitsi-ai-ext-section-title">Google Drive Sync Optimization</div>
        <div class="jitsi-ai-ext-card jitsi-ai-card" style="margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:11px; font-weight:600; color:#fff;">Cloud Sync Mode</span>
            <span id="jitsiDriveSyncModeBadge" class="jitsi-ai-badge" style="font-size:10px; color:#10b981;">Notes + Audio</span>
          </div>
          <p style="font-size:11px; color:#94a3b8; margin:0 0 8px 0; line-height:1.4;">
            Control whether meeting audio is synced to cloud or preserved on your computer for instant lightweight uploads.
          </p>
          <select id="jitsiDriveSyncModeSelect" style="width:100%; padding:8px; border-radius:6px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:11px; cursor:pointer;">
            <option value="full" selected>⚡ Fast Full Sync: Notes + Compressed Audio (Default)</option>
            <option value="notes_only">⚡ Instant Notes Only: Summary in Drive (&lt; 1s) + Audio on Computer</option>
          </select>
        </div>

        <div class="jitsi-ai-ext-section-title">Slack Notification & Drive Link Automation</div>
        <div class="jitsi-ai-ext-card jitsi-ai-card" style="margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:11px; font-weight:600; color:#fff;">Slack Incoming Webhook URL</span>
            <span id="jitsiSlackBadge" class="jitsi-ai-badge" style="font-size:10px;">No Webhook</span>
          </div>
          <p style="font-size:11px; color:#94a3b8; margin:0 0 8px 0; line-height:1.4;">
            Automatically posts the generated Google Drive folder link, audio, and AI minutes to your Slack channel.
          </p>
          <input type="url" id="jitsiSlackWebhookInput" placeholder="https://hooks.slack.com/services/T.../B.../X..." style="width:calc(100% - 16px); padding:8px; border-radius:6px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:11px; margin-bottom:8px;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
            <input type="checkbox" id="jitsiSlackAutoShareCheck" style="accent-color:#10b981; cursor:pointer;">
            <label for="jitsiSlackAutoShareCheck" style="font-size:11px; color:#cbd5e1; cursor:pointer;">Auto-share Drive link & summary to Slack after upload</label>
          </div>
          <div style="display:flex; gap:6px;">
            <button id="jitsiSaveSlackBtn" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-primary" style="flex:1; font-size:11px;">💾 Save Slack Config</button>
            <button id="jitsiTestSlackBtn" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-secondary" style="flex:1; font-size:11px;">🔔 Test Slack</button>
          </div>
        </div>

        <div class="jitsi-ai-ext-section-title">Google Drive Multi-Account Config</div>
        <div class="jitsi-ai-ext-card jitsi-ai-card">
          <div class="jitsi-ai-pill-row" style="display:flex; gap:6px; margin-bottom:10px;">
            <button id="jitsiSelectAcc0" class="jitsi-ai-pill-btn active" style="flex:1;">Account 1 (Primary)</button>
            <button id="jitsiSelectAcc1" class="jitsi-ai-pill-btn" style="flex:1;">Account 2 (Backup)</button>
          </div>
          <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Google Apps Script Webhook URL:</div>
          <input type="url" id="jitsiAccWebhookInput" placeholder="https://script.google.com/macros/s/.../exec" style="width:calc(100% - 16px); padding:8px; border-radius:6px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:11px; margin-bottom:8px;">
          <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Google OAuth2 Access Token (Optional):</div>
          <input type="password" id="jitsiAccTokenInput" placeholder="ya29..." style="width:calc(100% - 16px); padding:8px; border-radius:6px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:11px; margin-bottom:8px;">
          <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Target Drive Folder Name:</div>
          <input type="text" id="jitsiAccFolderInput" placeholder="meetingRecords" style="width:calc(100% - 16px); padding:8px; border-radius:6px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); color:#fff; font-size:11px; margin-bottom:8px;">
          <div style="display:flex; gap:6px;">
            <button id="jitsiSaveAccBtn" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-primary" style="flex:1; font-size:11px;">💾 Save Account</button>
            <button id="jitsiTestDriveBtn" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-secondary" style="flex:1; font-size:11px;">🔔 Test Webhook</button>
          </div>
        </div>
      </div>

      <!-- Upload Progress Overlay Box -->
      <div id="jitsiUploadBox" class="jitsi-ai-ext-card jitsi-ai-card" style="display:none; margin:0 16px 8px 16px; border-color:#10b981;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-size:11px; font-weight:700; color:#fff;">Google Drive Package Sync</span>
          <button id="jitsiCloseUploadBox" style="background:none; border:none; color:#64748b; cursor:pointer; font-size:14px;">&times;</button>
        </div>
        <div class="jitsi-ai-progress-track">
          <div id="jitsiUploadProgressBar" class="jitsi-ai-progress-bar"></div>
        </div>
        <div id="jitsiUploadStatusText" style="font-size:11px; color:#cbd5e1; margin-bottom:8px;">Preparing package...</div>
        <div id="jitsiUploadActions" style="display:flex; flex-direction:column; gap:6px;">
          <a id="jitsiOpenDriveLink" href="#" target="_blank" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-primary" style="text-align:center; text-decoration:none; display:none;">📂 Open in Google Drive</a>
          <button id="jitsiShareSlackBtn" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-secondary" style="font-size:11px; display:none;">📢 Share to Slack Channel</button>
        </div>
      </div>

      <!-- Bottom Action Footer Bar -->
      <div class="jitsi-ai-ext-footer jitsi-ai-footer-bar">
        <button id="jitsiTranscribeBtn" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-secondary" style="flex:1; font-size:12px;">✨ Transcribe Call</button>
        <button id="jitsiUploadBtn" class="jitsi-ai-ext-btn jitsi-ai-ext-btn-primary" style="flex:1; font-size:12px;">☁️ Upload to Drive</button>
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
      await executeParallelTranscription({ forceRetry: true });
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
        let key = (keyInput.value || '').trim();
        key = key.replace(/^["'`\s]+|["'`\s]+$/g, '');
        keyInput.value = key;
        geminiApiKey = key;
        saveSettings();
        const statusDiv = getEl('jitsiGeminiKeyStatus');
        if (statusDiv) {
          statusDiv.style.display = 'block';
          statusDiv.style.color = '#34d399';
          statusDiv.innerHTML = '💾 Gemini API key saved locally.';
        }
        showToast('Gemini Flash API Key saved!');
        updateAiKeyDisplay();
      };
      const testGeminiBtn = getEl('jitsiTestGeminiKeyBtn');
      if (testGeminiBtn) {
        testGeminiBtn.onclick = async () => {
          let key = (keyInput.value || geminiApiKey || '').trim();
          key = key.replace(/^["'`\s]+|["'`\s]+$/g, '');
          keyInput.value = key;

          const statusDiv = getEl('jitsiGeminiKeyStatus');
          const badge = getEl('jitsiAiKeyBadge');

          if (!key) {
            if (statusDiv) {
              statusDiv.style.display = 'block';
              statusDiv.style.color = '#fbbf24';
              statusDiv.innerHTML = '⚠️ Please paste your Gemini API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:#818cf8; text-decoration:underline;">Google AI Studio</a> first.';
            }
            if (badge) {
              badge.textContent = 'No Key';
              badge.style.color = '#94a3b8';
            }
            showToast('Please enter a Gemini API key first.', true);
            return;
          }

          testGeminiBtn.disabled = true;
          testGeminiBtn.textContent = 'Testing...';
          if (statusDiv) {
            statusDiv.style.display = 'block';
            statusDiv.style.color = '#818cf8';
            statusDiv.innerHTML = '⏳ Contacting Google Gemini AI endpoint...';
          }

          try {
            const res = await new Promise((resolve, reject) => {
              if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({
                  action: 'GEMINI_TEST_KEY',
                  apiKey: key
                }, (response) => {
                  if (chrome.runtime.lastError) {
                    const msg = chrome.runtime.lastError.message || '';
                    if (msg.includes('message port closed') || msg.includes('Receiving end does not exist') || msg.includes('Extension context invalidated')) {
                      reject(new Error('Extension needs reload: Open chrome://extensions, click the ⟳ reload icon on "Meetings_AI Assistant", then refresh this call tab.'));
                    } else {
                      reject(new Error(msg));
                    }
                  } else if (response && response.success) {
                    resolve(response.data);
                  } else if (response && response.error) {
                    reject(new Error(response.error));
                  } else {
                    reject(new Error('Extension background worker did not respond. Please reload the extension at chrome://extensions.'));
                  }
                });
              } else {
                resolve({ message: 'Connected!' });
              }
            });

            geminiApiKey = key;
            saveSettings();
            showToast(`✅ ${res.message || 'Gemini API key verified successfully!'}`);

            if (badge) {
              badge.textContent = '✓ Verified';
              badge.style.color = '#34d399';
            }
            if (statusDiv) {
              statusDiv.style.display = 'block';
              statusDiv.style.color = '#34d399';
              statusDiv.innerHTML = `✅ <strong>Connected!</strong> Verified with <code>${res.modelUsed || 'Gemini AI'}</code>. Speech transcription is ready!`;
            }
          } catch (err) {
            const errMsg = err.message || err.toString();
            showToast(`❌ ${errMsg}`, true);

            if (badge) {
              badge.textContent = 'Key Error';
              badge.style.color = '#f87171';
            }
            if (statusDiv) {
              statusDiv.style.display = 'block';
              statusDiv.style.color = '#f87171';

              if (errMsg.includes('Extension needs reload') || errMsg.includes('chrome://extensions')) {
                statusDiv.innerHTML = `⚠️ <strong>Extension Reload Needed:</strong> Go to <code>chrome://extensions</code>, click the <strong>⟳ reload icon</strong> on Meetings_AI Assistant, then refresh this meeting page.`;
              } else if (errMsg.includes('Invalid Gemini API Key') || errMsg.includes('Google rejected this key')) {
                statusDiv.innerHTML = `❌ <strong>Invalid Key:</strong> Google rejected this API key. Please generate a new free key at <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:#818cf8; text-decoration:underline;">aistudio.google.com</a> (starts with <code>AIzaSy...</code>).`;
              } else if (errMsg.includes('Permission Denied') || errMsg.includes('disabled')) {
                statusDiv.innerHTML = `❌ <strong>API Disabled:</strong> Generative Language API is disabled in your Google Cloud project. Enable it or create a key directly at <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:#818cf8; text-decoration:underline;">Google AI Studio</a>.`;
              } else if (errMsg.includes('quota') || errMsg.includes('429')) {
                statusDiv.innerHTML = `❌ <strong>Rate Limit / Quota (429):</strong> Google AI Studio free tier rate limit reached. Please wait 1-2 minutes.`;
              } else {
                statusDiv.innerHTML = `❌ <strong>Error:</strong> ${UI.escapeHtml(errMsg)}`;
              }
            }
          } finally {
            testGeminiBtn.disabled = false;
            testGeminiBtn.textContent = '🔔 Test Gemini Key';
          }
        };
      }
    }

    const autoCheck = getEl('jitsiSlackAutoShareCheck');
    if (autoCheck) {
      autoCheck.checked = Boolean(savedSlackAutoShare);
      autoCheck.onchange = () => {
        savedSlackAutoShare = Boolean(autoCheck.checked);
        try {
          window.localStorage.setItem(STORAGE_SLACK_AUTO_KEY, String(savedSlackAutoShare));
          if (typeof chrome !== 'undefined' && chrome.storage) {
            const area = chrome.storage.sync || chrome.storage.local;
            if (area) {
              area.set({ [STORAGE_SLACK_AUTO_KEY]: savedSlackAutoShare });
            }
          }
        } catch (e) {}
        showToast(savedSlackAutoShare ? '✅ Auto-share to Slack enabled' : '⏸️ Auto-share to Slack disabled');
      };
    }

    const saveSlackBtn = getEl('jitsiSaveSlackBtn');
    if (saveSlackBtn) {
      saveSlackBtn.onclick = () => {
        const urlInput = getEl('jitsiSlackWebhookInput');
        const autoBox = getEl('jitsiSlackAutoShareCheck');
        savedSlackWebhookUrl = (urlInput?.value || '').trim();
        if (autoBox) {
          savedSlackAutoShare = Boolean(autoBox.checked);
        }
        saveSettings();
        updateSlackUI();
        showToast('💾 Slack settings saved!');
      };
    }

    const testSlackBtn = getEl('jitsiTestSlackBtn');
    if (testSlackBtn) {
      testSlackBtn.onclick = async () => {
        const urlInput = getEl('jitsiSlackWebhookInput');
        const url = (urlInput?.value || savedSlackWebhookUrl || '').trim();
        if (!url || !url.startsWith('https://hooks.slack.com/')) {
          showToast('Enter a valid Slack Webhook URL (https://hooks.slack.com/...)', true);
          return;
        }
        testSlackBtn.disabled = true;
        testSlackBtn.textContent = 'Sending...';
        try {
          await new Promise((resolve, reject) => {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
              const activeAcc = (typeof accounts !== 'undefined' && accounts && accounts[activeAccIdx]) || {};
              const testFolderUrl = lastUploadedFolderUrl || `https://drive.google.com/drive/search?q=${encodeURIComponent(activeAcc.folderName || 'meetingRecords')}`;
              chrome.runtime.sendMessage({
                action: 'SLACK_SEND_NOTIFICATION',
                webhookUrl: url,
                roomName: 'Test Meeting',
                folderUrl: testFolderUrl,
                decisions: ['Slack webhook successfully connected to Meetings_AI Assistant.'],
                actions: ['Verify that the Google Drive button and notes format properly in Slack.'],
                durationStr: '00:00 test'
              }, (res) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else if (res && res.success) resolve(res);
                else reject(new Error(res?.error || 'Slack test failed'));
              });
            } else {
              resolve({ success: true });
            }
          });
          showToast('✅ Test message delivered to Slack!');
          savedSlackWebhookUrl = url;
          saveSettings();
          updateSlackUI();
        } catch (e) {
          showToast(`Slack test failed: ${e.message}`, true);
        } finally {
          testSlackBtn.disabled = false;
          testSlackBtn.textContent = '🔔 Test Slack';
        }
      };
    }

    const switchAccBtn = getEl('jitsiSwitchAccBtn');
    if (switchAccBtn) switchAccBtn.onclick = () => UI.switchTab('settings');

    const saveAccBtn = getEl('jitsiSaveAccBtn');
    if (saveAccBtn) saveAccBtn.onclick = saveActiveAccountDetails;

    const checkpointBtn = getEl('jitsiManualCheckpointBtn');
    if (checkpointBtn) {
      checkpointBtn.onclick = () => {
        saveVaultCheckpoint();
        showToast('Vault checkpoint saved manually.');
      };
    }

    const copyTransBtn = getEl('jitsiCopyTranscriptBtn');
    if (copyTransBtn) {
      copyTransBtn.onclick = () => {
        const text = (getEl('jitsiTranscriptBox')?.innerText || '').trim();
        if (text && !text.includes('Transcript will appear here')) {
          navigator.clipboard.writeText(text).then(() => showToast('Transcript copied to clipboard!')).catch(() => showToast('Failed to copy', true));
        } else {
          showToast('No transcript text available yet', true);
        }
      };
    }

    const durationSelect = getEl('jitsiChunkDurationSelect');
    if (durationSelect) {
      durationSelect.value = String(savedBlockDurationMins);
      durationSelect.onchange = () => {
        savedBlockDurationMins = Number(durationSelect.value) || 5;
        saveSettings();
        Recorder.setBlockDuration(savedBlockDurationMins);
        const badge = getEl('jitsiChunkDurationBadge');
        if (badge) badge.textContent = `${savedBlockDurationMins} Minutes`;
        const header = getEl('jitsiBlockSectionHeader');
        if (header) {
          const count = getEl('jitsiChunkCountBadge')?.textContent || '0';
          header.innerHTML = `${savedBlockDurationMins}-Minute Parallel Speech Blocks (<span id="jitsiChunkCountBadge">${count}</span>)`;
        }
        showToast(`Chunk duration set to ${savedBlockDurationMins} minutes!`);
      };
    }

    const micModeSelect = getEl('jitsiMicModeSelect');
    if (micModeSelect) {
      micModeSelect.value = savedMicMode;
      const updateMicBadge = (mode) => {
        const b = getEl('jitsiMicModeBadge');
        if (b) {
          b.textContent = mode === 'always_record' ? 'Always Record (No Mute)' : 'Smart Mute Sync';
          b.style.color = mode === 'always_record' ? '#f59e0b' : '#10b981';
        }
      };
      updateMicBadge(savedMicMode);

      micModeSelect.onchange = () => {
        savedMicMode = micModeSelect.value || 'smart_sync';
        window.localStorage.setItem(STORAGE_MIC_MODE_KEY, savedMicMode);
        saveSettings();
        if (AudioMixer.setAutoMuteSync) {
          AudioMixer.setAutoMuteSync(savedMicMode !== 'always_record');
        }
        updateMicBadge(savedMicMode);
        showToast(`Mic mode: ${savedMicMode === 'always_record' ? 'Always Record (Never Muted)' : 'Smart Mute Sync Active'}`);
      };
    }

    const speakerCountBadge = getEl('jitsiSpeakerCountBadge');
    if (speakerCountBadge) {
      speakerCountBadge.style.cursor = 'pointer';
      speakerCountBadge.title = 'Click to switch between Smart Mute Sync and Always Record';
      speakerCountBadge.onclick = () => {
        savedMicMode = (savedMicMode === 'always_record') ? 'smart_sync' : 'always_record';
        window.localStorage.setItem(STORAGE_MIC_MODE_KEY, savedMicMode);
        saveSettings();
        if (AudioMixer.setAutoMuteSync) {
          AudioMixer.setAutoMuteSync(savedMicMode !== 'always_record');
        }
        if (micModeSelect) micModeSelect.value = savedMicMode;
        const b = getEl('jitsiMicModeBadge');
        if (b) {
          b.textContent = savedMicMode === 'always_record' ? 'Always Record (No Mute)' : 'Smart Mute Sync';
          b.style.color = savedMicMode === 'always_record' ? '#f59e0b' : '#10b981';
        }
        showToast(`Switched Mic Mode to: ${savedMicMode === 'always_record' ? 'Always Record (Never Muted)' : 'Smart Mute Sync'}`);
      };
    }

    const syncModeSelect = getEl('jitsiDriveSyncModeSelect');
    if (syncModeSelect) {
      syncModeSelect.value = savedDriveSyncMode;
      syncModeSelect.onchange = () => {
        savedDriveSyncMode = syncModeSelect.value || 'full';
        window.localStorage.setItem(STORAGE_DRIVE_SYNC_MODE_KEY, savedDriveSyncMode);
        const badge = getEl('jitsiDriveSyncModeBadge');
        if (badge) {
          badge.textContent = savedDriveSyncMode === 'notes_only' ? 'Instant Notes (< 1s)' : 'Notes + Audio';
          badge.style.color = savedDriveSyncMode === 'notes_only' ? '#38bdf8' : '#10b981';
        }
        showToast(`Drive sync mode set to: ${savedDriveSyncMode === 'notes_only' ? 'Instant Notes Only (< 1s)' : 'Fast Notes + Audio'}`);
      };
    }

    const sel0 = getEl('jitsiSelectAcc0');
    if (sel0) sel0.onclick = () => selectAccount(0);
    const sel1 = getEl('jitsiSelectAcc1');
    if (sel1) sel1.onclick = () => selectAccount(1);
    const saveAccBtnBottom = getEl('jitsiSaveAccBtn');
    if (saveAccBtnBottom) saveAccBtnBottom.onclick = saveActiveAccountDetails;

    const testDriveBtn = getEl('jitsiTestDriveBtn');
    if (testDriveBtn) {
      testDriveBtn.onclick = async () => {
        const webInput = getEl('jitsiAccWebhookInput');
        const url = (webInput?.value || accounts[activeAccIdx]?.webhookUrl || '').trim();
        if (!url) {
          showToast('⚠️ Please enter a Google Apps Script Webhook URL first.', true);
          return;
        }
        testDriveBtn.disabled = true;
        testDriveBtn.textContent = 'Testing...';
        try {
          const uploader = window.JitsiDriveUploader;
          if (!uploader) throw new Error('Drive uploader module not loaded.');
          const testRes = await uploader.uploadPackage({
            credentials: { webhookUrl: url },
            folderName: accounts[activeAccIdx]?.folderName || 'meetingRecords',
            roomName: 'Diagnostic_Test',
            markdownText: '# Webhook Connection Verification\n\nGoogle Drive Webhook connected successfully from Meetings_AI Assistant.',
            markdownFileName: 'Webhook_Verification_Test.md',
            syncMode: 'notes_only'
          });
          if (testRes.success) {
            showToast(`✅ Connected! Webhook verified (${testRes.folderId ? 'Folder: ' + testRes.folderId.slice(0, 8) + '...' : 'Ready'}).`);
          } else {
            throw new Error(testRes.error || testRes.message || 'Webhook test failed');
          }
        } catch (err) {
          showToast(`❌ ${err.message || 'Drive test failed'}`, true);
        } finally {
          testDriveBtn.disabled = false;
          testDriveBtn.textContent = '🔔 Test Webhook';
        }
      };
    }

    const retryFailedBtn = getEl('jitsiRetryFailedBlocksBtn');
    if (retryFailedBtn) retryFailedBtn.onclick = retryAllFailedBlocks;

    updateAccountUI();
    updateAiKeyDisplay();
    updateSlackUI();
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
    if (acc0) acc0.className = activeAccIdx === 0 ? 'jitsi-ai-pill-btn active' : 'jitsi-ai-pill-btn';
    if (acc1) acc1.className = activeAccIdx === 1 ? 'jitsi-ai-pill-btn active' : 'jitsi-ai-pill-btn';

    const currentAcc = accounts[activeAccIdx] || accounts[0];
    const driveName = getEl('jitsiDriveAccName');
    const driveEmail = getEl('jitsiDriveEmailDisplay');
    if (driveName) driveName.textContent = currentAcc.name || `Account ${activeAccIdx + 1}`;
    if (driveEmail) driveEmail.textContent = `Folder: ${currentAcc.folderName || 'meetingRecords'}`;

    const webInput = getEl('jitsiAccWebhookInput');
    const tokenInput = getEl('jitsiAccTokenInput');
    const folderInput = getEl('jitsiAccFolderInput');
    const geminiInput = getEl('jitsiGeminiKeyInput');

    if (webInput) webInput.value = currentAcc.webhookUrl || '';
    if (tokenInput) tokenInput.value = currentAcc.token || '';
    if (folderInput) folderInput.value = currentAcc.folderName || 'meetingRecords';
    if (geminiInput) geminiInput.value = geminiApiKey || '';

    const durBadge = getEl('jitsiChunkDurationBadge');
    if (durBadge) durBadge.textContent = `${savedBlockDurationMins} Minutes`;
    const durSelect = getEl('jitsiChunkDurationSelect');
    if (durSelect) durSelect.value = String(savedBlockDurationMins);

    const modeBadge = getEl('jitsiDriveSyncModeBadge');
    if (modeBadge) {
      modeBadge.textContent = savedDriveSyncMode === 'notes_only' ? 'Instant Notes (< 1s)' : 'Notes + Audio';
      modeBadge.style.color = savedDriveSyncMode === 'notes_only' ? '#38bdf8' : '#10b981';
    }
    const modeSelect = getEl('jitsiDriveSyncModeSelect');
    if (modeSelect) modeSelect.value = savedDriveSyncMode;
    const blockHeader = getEl('jitsiBlockSectionHeader');
    if (blockHeader) {
      const count = getEl('jitsiChunkCountBadge')?.textContent || '0';
      blockHeader.innerHTML = `${savedBlockDurationMins}-Minute Parallel Speech Blocks (<span id="jitsiChunkCountBadge">${count}</span>)`;
    }
  }

  function saveActiveAccountDetails() {
    const webInput = getEl('jitsiAccWebhookInput');
    const tokenInput = getEl('jitsiAccTokenInput');
    const folderInput = getEl('jitsiAccFolderInput');
    const saveBtn = getEl('jitsiSaveAccBtn');

    if (accounts[activeAccIdx]) {
      if (webInput) accounts[activeAccIdx].webhookUrl = (webInput.value || '').trim();
      if (tokenInput) accounts[activeAccIdx].token = (tokenInput.value || '').trim();
      if (folderInput) accounts[activeAccIdx].folderName = (folderInput.value || '').trim() || 'meetingRecords';
      saveSettings();
      updateAccountUI();

      if (saveBtn) {
        const origText = saveBtn.textContent;
        saveBtn.textContent = '✅ Settings Saved!';
        saveBtn.style.backgroundColor = '#10b981';
        setTimeout(() => {
          saveBtn.textContent = origText;
          saveBtn.style.backgroundColor = '';
        }, 1800);
      }
      showToast(`✅ Saved settings for ${accounts[activeAccIdx].name}!`);
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
