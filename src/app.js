/**
 * Application Entry Point & Orchestrator
 * Integrates Jitsi Meet, Speech-to-Text, Real-Time AI Notes, Screen/Audio Recorder,
 * and Google Drive Auto-Sync with simple ID/password quota switching.
 */

import { JitsiService } from './services/jitsi.js';
import { TranscriptionService } from './services/transcription.js';
import { AiNotesService } from './services/aiNotes.js';
import { MeetingRecorderService } from './services/recorder.js';
import { GoogleDriveService } from './services/googleDrive.js';

class App {
  constructor() {
    this.jitsi = null;
    this.stt = null;
    this.ai = null;
    this.recorder = null;
    this.drive = null;

    // Current State
    this.currentRecording = null;
    this.currentSummaryMarkdown = '';
    this.activeSettingsAccount = null;
    this.callActive = false;

    this.init();
  }

  init() {
    this._initServices();
    this._bindDomElements();
    this._bindEvents();
    this._updateDriveHeaderChip();
    this._renderAccountsList();
    this._parseUrlParams();

    console.log('Jitsi AI Assistant & Google Drive Sync App Initialized.');
  }

  simulateSpeech(text, speaker = 'You') {
    if (this.stt) {
      this.stt.simulateSpeech(text, speaker);
    }
  }

  _parseUrlParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      const room = params.get('room');
      const user = params.get('user');
      const domain = params.get('domain');

      if (room && this.dom?.roomInput) {
        this.dom.roomInput.value = room;
      }
      if (user && this.dom?.userInput) {
        this.dom.userInput.value = user;
      }
      if (domain && this.jitsi) {
        this.jitsi.setDomain(domain);
        const prefix = document.querySelector('.room-prefix');
        if (prefix) prefix.textContent = `${domain}/`;
      }
    } catch (e) {
      console.warn('URL params parsing skipped:', e);
    }
  }

  _initServices() {
    // 1. Google Drive Service
    this.drive = new GoogleDriveService();

    // 2. AI Notes Service
    this.ai = new AiNotesService();

    // 3. Speech to Text Service
    this.stt = new TranscriptionService({
      speaker: 'You',
      onTranscriptChunk: (chunk, allChunks) => {
        this._appendTranscriptItem(chunk);
        this._updateTranscriptCount(allChunks.length);
        this._triggerLiveNotesUpdate(allChunks);
      },
      onInterimResult: (interimText) => {
        const interimBox = document.getElementById('interimTranscriptBox');
        const textSpan = document.getElementById('interimText');
        if (interimText) {
          interimBox.style.display = 'flex';
          textSpan.textContent = interimText;
        } else {
          interimBox.style.display = 'none';
          textSpan.textContent = '';
        }
      },
      onStatusChange: (status) => {
        const micDot = document.getElementById('micIndicator');
        const statusText = document.getElementById('sttStatusText');
        const sttBtnLabel = document.getElementById('sttBtnLabel');
        const toggleSttBtn = document.getElementById('toggleSttBtn');

        if (status.listening) {
          micDot.classList.remove('muted');
          statusText.textContent = 'Microphone listening';
          sttBtnLabel.textContent = 'STT Active';
          toggleSttBtn.classList.add('active');
        } else {
          micDot.classList.add('muted');
          statusText.textContent = status.text || 'STT Paused';
          sttBtnLabel.textContent = 'STT Muted';
          toggleSttBtn.classList.remove('active');
        }
      }
    });

    // 4. Recorder Service
    this.recorder = new MeetingRecorderService({
      onTimerTick: (timeFormatted) => {
        document.getElementById('recTimer').textContent = `REC ${timeFormatted}`;
      },
      onStateChange: (isRecording) => {
        const recBadge = document.getElementById('recordingBadge');
        const recBtn = document.getElementById('toggleRecordBtn');
        const recLabel = document.getElementById('recordBtnLabel');

        if (isRecording) {
          recBadge.classList.remove('hidden');
          recBtn.classList.add('is-recording');
          recLabel.textContent = 'Stop Recording';
          this._showToast('🔴 Meeting recording started (Screen & Audio mixed)');
        } else {
          recBadge.classList.add('hidden');
          recBtn.classList.remove('is-recording');
          recLabel.textContent = 'Start Recording';
        }
      },
      onRecordingComplete: (recordingData) => {
        this.currentRecording = recordingData;
        this._showToast(`💾 Recording saved: ${recordingData.filename} (${recordingData.sizeMb} MB)`);
        this._addUploadListItem(recordingData.filename, `${recordingData.sizeMb} MB`, 'Ready for Drive');
      }
    });

    // 5. Jitsi Service
    this.jitsi = new JitsiService('jitsiContainer', {
      onJoined: () => {
        this.callActive = true;
        this._showToast('Connected to Jitsi Meet conference room!');
        document.getElementById('joinBtnText').textContent = 'Leave Call';
        document.getElementById('joinMeetingBtn').classList.replace('btn-primary', 'btn-secondary');

        // Automatically start speech recognition if permitted
        this.stt.start();
      },
      onLeft: () => {
        this.callActive = false;
        document.getElementById('joinBtnText').textContent = 'Join Call';
        document.getElementById('joinMeetingBtn').classList.replace('btn-secondary', 'btn-primary');

        // Stop recorder if active
        if (this.recorder.isRecording) {
          this.recorder.stopRecording();
        }

        // Generate final executive summary and show auto-drive upload modal
        this._handlePostCallWrapUp();
      },
      onAudioMuteChanged: (isMuted) => {
        if (isMuted) {
          this.stt.stop();
        } else {
          this.stt.start();
        }
      }
    });
  }

  _bindDomElements() {
    this.dom = {
      roomInput: document.getElementById('roomNameInput'),
      userInput: document.getElementById('userNameInput'),
      joinBtn: document.getElementById('joinMeetingBtn'),
      recordBtn: document.getElementById('toggleRecordBtn'),
      sttBtn: document.getElementById('toggleSttBtn'),
      notesBtn: document.getElementById('generateNotesBtn'),
      exportDriveBtn: document.getElementById('exportDriveBtn'),
      copyNotesBtn: document.getElementById('copyNotesBtn'),
      clearTranscriptBtn: document.getElementById('clearTranscriptBtn'),
      notesContainer: document.getElementById('aiNotesContainer'),
      transcriptFeed: document.getElementById('transcriptFeed'),
      // Tabs
      tabBtns: document.querySelectorAll('.tab-btn'),
      tabContents: document.querySelectorAll('.tab-content'),
      // Modals
      openSettingsBtn: document.getElementById('openSettingsBtn'),
      driveStatusBtn: document.getElementById('driveStatusBtn'),
      settingsModal: document.getElementById('settingsModal'),
      closeSettingsBtn: document.getElementById('closeSettingsBtn'),
      closeSettingsFooterBtn: document.getElementById('closeSettingsFooterBtn'),
      postModal: document.getElementById('postMeetingModal'),
      closePostModalBtn: document.getElementById('closePostModalBtn'),
      confirmDriveUploadBtn: document.getElementById('confirmDriveUploadBtn'),
      downloadLocalZipBtn: document.getElementById('downloadLocalZipBtn'),
      // Settings fields
      accountLabelInput: document.getElementById('accountLabelInput'),
      clientIdInput: document.getElementById('clientIdInput'),
      clientSecretInput: document.getElementById('clientSecretInput'),
      driveFolderInput: document.getElementById('driveFolderInput'),
      storageLimitInput: document.getElementById('storageLimitInput'),
      saveAccountBtn: document.getElementById('saveAccountBtn'),
      addNewAccountBtn: document.getElementById('addNewAccountBtn'),
      aiProviderSelect: document.getElementById('aiProviderSelect'),
      aiApiKeyInput: document.getElementById('aiApiKeyInput'),
      simulateSpeechBtn: document.getElementById('simulateDemoSpeechBtn'),
      jitsiDomainInput: document.getElementById('jitsiDomainInput')
    };
  }

  _bindEvents() {
    // Join / Leave Room
    this.dom.joinBtn.addEventListener('click', () => {
      if (this.callActive) {
        this.jitsi.hangup();
      } else {
        const room = this.dom.roomInput.value.trim() || 'teamsync-demo';
        const user = this.dom.userInput.value.trim() || 'Team Member';
        this.stt.setSpeaker(user);
        this.jitsi.joinRoom(room, user);
        document.getElementById('targetFolderPath').textContent =
          `📁 meetingRecords / ${new Date().toISOString().slice(0, 10)}_${room}`;
      }
    });

    // Record Button
    this.dom.recordBtn.addEventListener('click', async () => {
      if (this.recorder.isRecording) {
        this.recorder.stopRecording();
      } else {
        try {
          await this.recorder.startRecording();
        } catch (e) {
          this._showToast('Recording cancelled or screen share denied.');
        }
      }
    });

    // Toggle STT
    this.dom.sttBtn.addEventListener('click', () => {
      this.stt.toggle();
    });

    // Force Update AI Notes
    this.dom.notesBtn.addEventListener('click', () => {
      this._triggerLiveNotesUpdate(this.stt.getTranscripts(), true);
    });

    // Save to Drive dock button
    this.dom.exportDriveBtn.addEventListener('click', () => {
      this._handlePostCallWrapUp();
    });

    // Copy Notes
    this.dom.copyNotesBtn.addEventListener('click', () => {
      const text = this.currentSummaryMarkdown || this.stt.getFullText();
      navigator.clipboard.writeText(text);
      this._showToast('📋 AI Notes copied to clipboard!');
    });

    // Clear Transcript
    this.dom.clearTranscriptBtn.addEventListener('click', () => {
      this.stt.clear();
      this.dom.transcriptFeed.innerHTML = '<div class="transcript-empty"><p>Speech will appear here with timestamps as you talk in the call.</p></div>';
      this._updateTranscriptCount(0);
    });

    // Tab Switching
    this.dom.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        this.dom.tabBtns.forEach(b => b.classList.remove('active'));
        this.dom.tabContents.forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const target = document.getElementById(tabId);
        if (target) target.classList.add('active');
      });
    });

    // Settings Modal Open/Close
    const openSettings = () => {
      this._populateAccountForm(this.drive.getActiveAccount());
      this.dom.settingsModal.classList.remove('hidden');
    };
    this.dom.openSettingsBtn.addEventListener('click', openSettings);
    this.dom.driveStatusBtn.addEventListener('click', openSettings);

    const closeSettings = () => this.dom.settingsModal.classList.add('hidden');
    this.dom.closeSettingsBtn.addEventListener('click', closeSettings);
    this.dom.closeSettingsFooterBtn.addEventListener('click', closeSettings);

    // Save Account Credentials
    this.dom.saveAccountBtn.addEventListener('click', () => {
      if (!this.activeSettingsAccount) return;
      this.drive.updateAccount(this.activeSettingsAccount.id, {
        name: this.dom.accountLabelInput.value.trim(),
        clientId: this.dom.clientIdInput.value.trim(),
        clientSecret: this.dom.clientSecretInput.value.trim(),
        folderName: this.dom.driveFolderInput.value.trim(),
        quotaGb: Number(this.dom.storageLimitInput.value)
      });
      this._renderAccountsList();
      this._updateDriveHeaderChip();
      this._showToast('✅ Account credentials updated successfully!');
    });

    // Add New Account
    this.dom.addNewAccountBtn.addEventListener('click', () => {
      const newAcc = this.drive.addAccount({
        name: `Account ${this.drive.getAllAccounts().length + 1} (Drive)`,
        clientId: '',
        clientSecret: '',
        quotaGb: 15.0
      });
      this._renderAccountsList();
      this._populateAccountForm(newAcc);
      this._updateDriveHeaderChip();
      this._showToast('✨ New Google Account added. Enter ID and Password!');
    });

    // AI Engine settings update
    this.dom.aiProviderSelect.addEventListener('change', () => {
      this.ai.configure(this.dom.aiProviderSelect.value, this.dom.aiApiKeyInput.value.trim());
    });
    this.dom.aiApiKeyInput.addEventListener('input', () => {
      this.ai.configure(this.dom.aiProviderSelect.value, this.dom.aiApiKeyInput.value.trim());
    });

    // Post-Call Modal Buttons
    this.dom.closePostModalBtn.addEventListener('click', () => {
      this.dom.postModal.classList.add('hidden');
    });

    this.dom.confirmDriveUploadBtn.addEventListener('click', () => {
      this._executeGoogleDriveUpload();
    });

    this.dom.downloadLocalZipBtn.addEventListener('click', () => {
      this._downloadLocalFiles();
    });

    // Simulate Speech Demo Button
    if (this.dom.simulateSpeechBtn) {
      this.dom.simulateSpeechBtn.addEventListener('click', () => {
        const demoLines = [
          { speaker: 'Alice (Product)', text: 'Welcome team. We agreed that the MVP deployment is scheduled for next Tuesday.' },
          { speaker: 'Bob (Lead Dev)', text: 'I will finalize the Kubernetes Helm charts and run the load tests by Thursday.' },
          { speaker: 'Charlie (Cloud Ops)', text: 'David needs to review the Google Drive quota and verify the auto-upload credentials before launch.' },
          { speaker: 'Alice (Product)', text: 'We decided to use the multi-account quota switcher so we never run out of free 15GB drive storage.' }
        ];
        demoLines.forEach((item, idx) => {
          setTimeout(() => {
            this.simulateSpeech(item.text, item.speaker);
          }, idx * 300);
        });
        this._showToast('⚡ Injected simulated meeting discussion!');
      });
    }

    // Jitsi Domain Setting Change
    if (this.dom.jitsiDomainInput) {
      this.dom.jitsiDomainInput.value = this.jitsi.domain;
      this.dom.jitsiDomainInput.addEventListener('change', () => {
        const newDomain = this.dom.jitsiDomainInput.value.trim() || 'meet.jit.si';
        this.jitsi.setDomain(newDomain);
        const prefix = document.querySelector('.room-prefix');
        if (prefix) prefix.textContent = `${newDomain}/`;
        this._showToast(`Jitsi domain set to: ${newDomain}`);
      });
    }
  }

  // ------------------------------------------------------------------------
  // Transcription & Live AI Notes
  // ------------------------------------------------------------------------
  _appendTranscriptItem(chunk) {
    const empty = this.dom.transcriptFeed.querySelector('.transcript-empty');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.className = 'transcript-item';
    item.innerHTML = `
      <div class="transcript-meta">
        <span class="speaker-label">${this._escapeHtml(chunk.speaker)}</span>
        <span class="time-label">${chunk.timestamp}</span>
      </div>
      <div class="transcript-text">${this._escapeHtml(chunk.text)}</div>
    `;

    this.dom.transcriptFeed.appendChild(item);
    this.dom.transcriptFeed.scrollTop = this.dom.transcriptFeed.scrollHeight;
  }

  _updateTranscriptCount(count) {
    document.getElementById('transcriptCount').textContent = count;
  }

  async _triggerLiveNotesUpdate(transcripts, forceToast = false) {
    if (!transcripts || transcripts.length === 0) {
      if (forceToast) this._showToast('Speak during the call to generate AI notes!');
      return;
    }

    const notes = await this.ai.generateLiveNotes(transcripts);
    if (!notes) return;

    this._renderLiveNotes(notes);
    if (forceToast) this._showToast('✨ AI notes refreshed!');
  }

  _renderLiveNotes(notes) {
    let html = '';

    // 1. Key Decisions
    if (notes.decisions && notes.decisions.length > 0) {
      html += `
        <div class="note-section-card">
          <div class="card-title decision">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            Key Decisions (${notes.decisions.length})
          </div>
          <ul class="note-list">
            ${notes.decisions.map(d => `<li><strong>${this._escapeHtml(d.speaker)}:</strong> ${this._escapeHtml(d.text)}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    // 2. Action Items
    if (notes.actionItems && notes.actionItems.length > 0) {
      html += `
        <div class="note-section-card">
          <div class="card-title action">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 11 12 14 22 4"/></svg>
            Action Items & Owners (${notes.actionItems.length})
          </div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${notes.actionItems.map(a => `
              <label class="action-checkbox-item">
                <input type="checkbox">
                <span><strong>${this._escapeHtml(a.speaker)}:</strong> ${this._escapeHtml(a.text)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      `;
    }

    // 3. Discussion Points
    if (notes.keypoints && notes.keypoints.length > 0) {
      html += `
        <div class="note-section-card">
          <div class="card-title keypoint">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            Discussion Highlights
          </div>
          <ul class="note-list">
            ${notes.keypoints.map(k => `<li>${this._escapeHtml(k.text)}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    if (html) {
      this.dom.notesContainer.innerHTML = html;
    }
  }

  // ------------------------------------------------------------------------
  // Post-Call Wrap Up & Drive Sync
  // ------------------------------------------------------------------------
  async _handlePostCallWrapUp() {
    const transcripts = this.stt.getTranscripts();
    const room = this.jitsi.getRoomName();
    const user = this.jitsi.getUserName();

    this.currentSummaryMarkdown = await this.ai.generatePostMeetingSummary({
      roomName: room,
      userName: user,
      duration: document.getElementById('recTimer').textContent.replace('REC ', '') || '12 mins'
    }, transcripts);

    // Populate post-call preview
    const previewBox = document.getElementById('postSummaryPreview');
    previewBox.innerHTML = this._markdownToHtml(this.currentSummaryMarkdown);

    // Setup modal account details
    const activeAcc = this.drive.getActiveAccount();
    const stats = this.drive.getStorageStats();
    document.getElementById('modalAccountName').textContent = activeAcc.name;
    document.getElementById('modalAccountSpace').textContent = `${stats.freeGb} GB free`;

    const quotaAlert = document.getElementById('quotaAlert');
    if (stats.isFull) {
      quotaAlert.style.display = 'block';
    } else {
      quotaAlert.style.display = 'none';
    }

    // Show modal
    this.dom.postModal.classList.remove('hidden');

    // Add upload card in tab 3
    this._addUploadListItem('Executive_Notes_Summary.md', '4.2 KB', 'Ready');
  }

  async _executeGoogleDriveUpload() {
    const progressFill = document.getElementById('uploadProgressBar');
    const progressText = document.getElementById('uploadProgressText');
    const confirmBtn = document.getElementById('confirmDriveUploadBtn');

    confirmBtn.disabled = true;

    const packageData = {
      folderName: `${new Date().toISOString().slice(0, 10)}_${this.jitsi.getRoomName()}`,
      notesText: this.currentSummaryMarkdown,
      videoBlob: this.currentRecording?.blob || null,
      transcripts: this.stt.getTranscripts()
    };

    try {
      const result = await this.drive.uploadMeetingPackage(packageData, (percent, text) => {
        progressFill.style.width = `${percent}%`;
        progressText.textContent = text;
      });

      this._showToast(`🚀 Uploaded to Google Drive successfully!`);
      this._updateDriveHeaderChip();

      // Show completed state
      progressText.innerHTML = `✅ <strong>Success:</strong> Uploaded to <code>${result.folderPath}</code>. <a href="${result.driveUrl}" target="_blank" style="color:#60a5fa;text-decoration:underline;">View in Google Drive</a>`;

      // Update upload tab
      this._addUploadListItem(`Folder: ${packageData.folderName}`, 'All Files', 'Uploaded');
    } catch (err) {
      progressText.textContent = '❌ Upload failed. Please check Drive credentials in settings.';
      this._showToast('Upload error. Try updating Drive password/token in settings.');
    } finally {
      confirmBtn.disabled = false;
    }
  }

  _downloadLocalFiles() {
    // 1. Download Markdown Summary
    const mdBlob = new Blob([this.currentSummaryMarkdown], { type: 'text/markdown' });
    this._triggerDownload(mdBlob, `Meeting_Notes_${this.jitsi.getRoomName()}.md`);

    // 2. Download Transcript JSON
    const jsonBlob = new Blob([JSON.stringify(this.stt.getTranscripts(), null, 2)], { type: 'application/json' });
    this._triggerDownload(jsonBlob, `Transcript_${this.jitsi.getRoomName()}.json`);

    // 3. Download Video if recorded
    if (this.currentRecording && this.currentRecording.blob) {
      this._triggerDownload(this.currentRecording.blob, this.currentRecording.filename);
    }

    this._showToast('💾 Files downloaded locally!');
  }

  _triggerDownload(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ------------------------------------------------------------------------
  // Google Drive Account Manager & Settings Form
  // ------------------------------------------------------------------------
  _renderAccountsList() {
    const list = document.getElementById('accountsTabsList');
    list.innerHTML = '';

    const accounts = this.drive.getAllAccounts();
    const activeAcc = this.drive.getActiveAccount();

    accounts.forEach(acc => {
      const pill = document.createElement('button');
      pill.className = `account-pill-tab ${acc.id === activeAcc.id ? 'active' : ''}`;
      pill.innerHTML = `
        <span>${this._escapeHtml(acc.name)}</span>
        <span style="font-size:0.7em;opacity:0.8;">(${acc.quotaGb}GB)</span>
      `;
      pill.addEventListener('click', () => {
        this.drive.setActiveAccount(acc.id);
        this._renderAccountsList();
        this._populateAccountForm(acc);
        this._updateDriveHeaderChip();
        this._showToast(`Switched active Drive to: ${acc.name}`);
      });
      list.appendChild(pill);
    });
  }

  _populateAccountForm(acc) {
    this.activeSettingsAccount = acc;
    this.dom.accountLabelInput.value = acc.name || '';
    this.dom.clientIdInput.value = acc.clientId || '';
    this.dom.clientSecretInput.value = acc.clientSecret || '';
    this.dom.driveFolderInput.value = acc.folderName || 'meetingRecords';
    this.dom.storageLimitInput.value = String(acc.quotaGb || 15);

    const stats = this.drive.getStorageStats(acc.id);
    const meterFill = document.getElementById('meterFill');
    const meterText = document.getElementById('meterText');

    meterText.textContent = `${stats.usedGb} GB used / ${stats.totalGb} GB total (${stats.freeGb} GB free)`;
    meterFill.style.width = `${stats.percentUsed}%`;

    meterFill.className = 'meter-fill';
    if (stats.percentUsed > 85) meterFill.classList.add('danger');
    else if (stats.percentUsed > 65) meterFill.classList.add('warning');
  }

  _updateDriveHeaderChip() {
    const acc = this.drive.getActiveAccount();
    const stats = this.drive.getStorageStats();

    document.getElementById('activeAccountLabel').textContent = `Drive: ${acc.name}`;
    document.getElementById('driveQuotaBadge').textContent = `${stats.freeGb} GB free`;
  }

  _addUploadListItem(name, size, status) {
    const list = document.getElementById('uploadList');
    const card = document.createElement('div');
    card.className = 'upload-card';
    card.innerHTML = `
      <div class="upload-card-info">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="color:#34d399;"><path d="M7.71 3.5 1.15 15l3.43 6 6.55-11.5L7.71 3.5z"/></svg>
        <div>
          <div class="upload-card-name">${this._escapeHtml(name)}</div>
          <div class="upload-card-size">${size}</div>
        </div>
      </div>
      <span class="upload-badge-status ${status === 'Uploaded' ? 'status-done' : 'status-uploading'}">${status}</span>
    `;
    list.prepend(card);
  }

  // ------------------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------------------
  _showToast(msg) {
    const toast = document.getElementById('toastNotification');
    const text = document.getElementById('toastMessage');
    text.textContent = msg;
    toast.classList.remove('hidden');

    if (this._toastTimeout) clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.classList.add('hidden');
    }, 3500);
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  _markdownToHtml(md) {
    if (!md) return '';
    return md
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      .replace(/\[ \]/g, '<input type="checkbox" disabled>')
      .replace(/\[x\]/g, '<input type="checkbox" checked disabled>')
      .replace(/^\- (.*$)/gim, '<li>$1</li>')
      .replace(/`([^`]+)`/gim, '<code>$1</code>')
      .replace(/\n$/gim, '<br />');
  }
}

// Instantiate on load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
