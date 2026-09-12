/**
 * Jitsi AI Assistant - Multi-Participant Audio Mixer & VAD Engine
 * Mixes local microphone with all remote WebRTC audio streams and runs real-time Voice Activity Detection.
 */

(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  }
  if (typeof root !== 'undefined') {
    root.JitsiAudioMixer = mod;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  let audioCtx = null;
  let analyser = null;
  let mixerDest = null;
  let micStream = null;
  let micGainNode = null;
  let isLocalMicMuted = false;
  let manualMicMuteOverride = false;
  let connectedAudioElements = new Set();
  let connectedStreamIds = new Set();
  let remotePollInterval = null;
  let hasAttachedWindowListeners = false;

  // VAD state
  let vadMonitorInterval = null;
  let vadDataArray = null;
  let vadState = 'silence';
  let activeSpeechDurationSec = 0;
  let silenceDurationSec = 0;

  /**
   * Detects whether the user's mic is turned off / muted in Google Meet or Jitsi Meet
   */
  function isMeetingMicMuted() {
    if (manualMicMuteOverride) return true;

    // 1. Google Meet detection
    try {
      const gmeetBtn = document.querySelector(
        'button[data-is-muted], div[data-is-muted], button[aria-label*="microphone" i], button[aria-label*="mic" i]'
      );
      if (gmeetBtn) {
        const isMutedAttr = gmeetBtn.getAttribute('data-is-muted');
        if (isMutedAttr === 'true') return true;
        if (isMutedAttr === 'false') return false;

        const label = (gmeetBtn.getAttribute('aria-label') || '').toLowerCase();
        // In Google Meet: "Turn on microphone" means it is currently OFF
        if (label.includes('turn on microphone') || label.includes('unmute') || label.includes('mic is off')) {
          return true;
        }
        if (label.includes('turn off microphone') || label.includes('mic is on')) {
          return false;
        }
      }

      const gmeetMutedIcon = document.querySelector('i[data-is-muted="true"], [data-is-muted="true"]');
      if (gmeetMutedIcon) return true;
    } catch (e) {}

    // 2. Jitsi Meet detection
    try {
      if (typeof window !== 'undefined' && window.APP && window.APP.conference && typeof window.APP.conference.isLocalAudioMuted === 'function') {
        return window.APP.conference.isLocalAudioMuted();
      }
    } catch (e) {}

    try {
      const jitsiBtn = document.querySelector('#audio-mute, [data-testid="audio-mute"], [aria-label*="mute audio" i], [aria-label*="unmute audio" i]');
      if (jitsiBtn) {
        const label = (jitsiBtn.getAttribute('aria-label') || '').toLowerCase();
        const classList = jitsiBtn.className || '';
        if (label.includes('unmute') || classList.includes('toggled') || classList.includes('selected') || classList.includes('muted')) {
          return true;
        }
      }
    } catch (e) {}

    return false;
  }

  /**
   * Synchronizes local microphone capture with meeting mute status.
   * If mic is off, gain is set to 0 and tracks are silenced immediately.
   */
  function syncLocalMicState() {
    if (!micGainNode || !audioCtx) return;

    const shouldMute = isMeetingMicMuted();
    if (shouldMute !== isLocalMicMuted) {
      isLocalMicMuted = shouldMute;
      if (isLocalMicMuted) {
        // Zero gain immediately so no audio data reaches mixerDest or analyser
        try { micGainNode.gain.setValueAtTime(0, audioCtx.currentTime); } catch (e) {}
        if (micStream) {
          micStream.getAudioTracks().forEach(track => { track.enabled = false; });
        }
        console.log('[Audio Mixer] Meeting mic is OFF -> silenced local audio capture.');
      } else {
        if (micStream) {
          micStream.getAudioTracks().forEach(track => { track.enabled = true; });
        }
        try { micGainNode.gain.setValueAtTime(1, audioCtx.currentTime); } catch (e) {}
        console.log('[Audio Mixer] Meeting mic is ON -> resumed local audio capture.');
      }
    }

    // Update UI speaker badge
    const badge = document.getElementById('jitsiSpeakerCountBadge');
    if (badge) {
      const remoteCount = connectedAudioElements.size;
      badge.textContent = isLocalMicMuted
        ? `🔇 You Muted (${remoteCount} Remote)`
        : `🎙️ You + ${remoteCount} Remote`;
    }
  }

  async function initAudioMixer(sidebarElement) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('AudioContext is not supported in this browser.');
    }

    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    mixerDest = audioCtx.createMediaStreamDestination();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.3;
    analyser.connect(mixerDest);

    connectedAudioElements.clear();
    connectedStreamIds.clear();

    // 1. Capture Local Microphone with dynamic mute gating
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      const micSource = audioCtx.createMediaStreamSource(micStream);
      micGainNode = audioCtx.createGain();
      micGainNode.gain.setValueAtTime(1, audioCtx.currentTime);
      micSource.connect(micGainNode);
      micGainNode.connect(analyser);
      console.log('[Audio Mixer] Local microphone connected with automatic mute synchronization.');

      // Check initial state
      syncLocalMicState();
    } catch (err) {
      console.warn('[Audio Mixer] Local mic permission denied or unavailable:', err);
    }

    // 2. Discover Remote Participant Audio immediately
    connectRemoteAudioElements();

    // 3. Periodic participant check every 2.5 seconds (0% CPU impact, no DOM recursion, robust multi-participant pickup)
    if (remotePollInterval) clearInterval(remotePollInterval);
    remotePollInterval = setInterval(connectRemoteAudioElements, 2500);

    // 4. Listen for user mic toggle clicks / shortcuts (Ctrl+D for Google Meet, M for Jitsi)
    if (typeof window !== 'undefined' && !hasAttachedWindowListeners) {
      hasAttachedWindowListeners = true;
      window.addEventListener('click', () => setTimeout(syncLocalMicState, 60));
      window.addEventListener('keydown', (e) => {
        if (e.key === 'd' || e.key === 'D' || e.key === 'm' || e.key === 'M') {
          setTimeout(syncLocalMicState, 120);
        }
      });
    }

    return mixerDest.stream;
  }

  function connectRemoteAudioElements() {
    if (!audioCtx || !analyser) return;

    // Discover both audio and video elements (Jitsi and Meet attach tracks to either)
    const mediaElements = document.querySelectorAll('audio, video');
    let remoteCount = 0;

    mediaElements.forEach(mediaEl => {
      // Skip assistant sidebar media elements
      if (mediaEl.closest && (mediaEl.closest('.jitsi-ai-sidebar') || mediaEl.closest('#jitsi-ai-sidebar'))) {
        return;
      }

      const srcObj = mediaEl.srcObject;
      if (!srcObj || typeof srcObj.getAudioTracks !== 'function') return;

      const audioTracks = srcObj.getAudioTracks();
      if (audioTracks.length === 0) return;

      // Skip local microphone stream if attached to self-view
      if (micStream && srcObj.id === micStream.id) return;

      // Count if already connected
      if (connectedStreamIds.has(srcObj.id) || connectedAudioElements.has(mediaEl)) {
        remoteCount++;
        return;
      }

      try {
        const remoteSource = audioCtx.createMediaStreamSource(srcObj);
        remoteSource.connect(analyser);
        connectedAudioElements.add(mediaEl);
        connectedStreamIds.add(srcObj.id);
        remoteCount++;
        console.log('[Audio Mixer] Connected remote participant stream:', srcObj.id);
      } catch (e) {
        // Track might be dead or restricted
        console.warn('[Audio Mixer] Remote audio connect notice:', e.message);
      }
    });

    const badge = document.getElementById('jitsiSpeakerCountBadge');
    if (badge) {
      const targetText = isLocalMicMuted
        ? `🔇 You Muted (${remoteCount} Remote)`
        : `🎙️ You + ${remoteCount} Remote`;
      if (badge.textContent !== targetText) {
        badge.textContent = targetText;
      }
    }
  }

  function initVAD(isRecordingFn) {
    if (!analyser) return;
    if (!vadDataArray) vadDataArray = new Uint8Array(analyser.frequencyBinCount);

    const SILENCE_THRESHOLD = 0.018; // ~ -38 dB
    let consecutiveSilenceFrames = 0;

    if (vadMonitorInterval) clearInterval(vadMonitorInterval);

    vadMonitorInterval = setInterval(() => {
      const recording = typeof isRecordingFn === 'function' ? isRecordingFn() : false;
      if (!recording || !analyser) return;

      // Real-time synchronization with meeting microphone mute status
      syncLocalMicState();

      analyser.getByteTimeDomainData(vadDataArray);

      let sum = 0;
      for (let i = 0; i < vadDataArray.length; i++) {
        const norm = (vadDataArray[i] - 128) / 128;
        sum += norm * norm;
      }
      const rms = Math.sqrt(sum / vadDataArray.length);

      // Visual Volume Meter
      const volPercent = Math.min(100, Math.round(rms * 450));
      const fillEl = document.getElementById('jitsiVolumeFill');
      if (fillEl) fillEl.style.width = `${volPercent}%`;

      const dot = document.getElementById('jitsiVadDot');
      const label = document.getElementById('jitsiVadLabel');

      if (isLocalMicMuted && connectedAudioElements.size === 0) {
        if (dot) dot.className = 'jitsi-ai-vad-dot silence';
        if (label) label.textContent = '🔇 Mic Off (Not Capturing)';
      } else if (rms > SILENCE_THRESHOLD) {
        consecutiveSilenceFrames = 0;
        if (vadState !== 'speaking') {
          vadState = 'speaking';
          if (dot) dot.className = 'jitsi-ai-vad-dot speaking';
          if (label) label.textContent = isLocalMicMuted ? '🟢 Remote Speaking' : '🟢 Speaking (Capturing)';
        }
        activeSpeechDurationSec += 0.1;
      } else {
        consecutiveSilenceFrames++;
        if (consecutiveSilenceFrames > 8) {
          if (vadState !== 'silence') {
            vadState = 'silence';
            if (dot) dot.className = 'jitsi-ai-vad-dot silence';
            if (label) label.textContent = isLocalMicMuted ? '🔇 Mic Off (Not Capturing)' : '⚪ Silence (Skipped)';
          }
          silenceDurationSec += 0.1;
        }
      }

      updateAudioStatsDisplay();
    }, 100);
  }

  function updateAudioStatsDisplay() {
    const cleanMin = Math.floor(activeSpeechDurationSec / 60);
    const cleanSec = Math.floor(activeSpeechDurationSec % 60);
    const cleanStr = `${String(cleanMin).padStart(2, '0')}:${String(cleanSec).padStart(2, '0')}`;

    const statsPill = document.getElementById('jitsiAudioStats');
    const cleanTimeEl = document.getElementById('jitsiCleanSpeechTime');
    const silenceRatioEl = document.getElementById('jitsiSilenceRatio');

    if (statsPill) statsPill.textContent = `${cleanStr} clean`;
    if (cleanTimeEl) cleanTimeEl.textContent = cleanStr;

    const total = activeSpeechDurationSec + silenceDurationSec;
    if (total > 0 && silenceRatioEl) {
      const savedPct = Math.round((silenceDurationSec / total) * 100);
      silenceRatioEl.textContent = `${savedPct}% saved`;
    }
  }

  function stopVAD() {
    if (vadMonitorInterval) {
      clearInterval(vadMonitorInterval);
      vadMonitorInterval = null;
    }
  }

  function resetVADStats() {
    activeSpeechDurationSec = 0;
    silenceDurationSec = 0;
    vadState = 'silence';
    updateAudioStatsDisplay();
  }

  function cleanupMixer() {
    stopVAD();
    if (remotePollInterval) {
      clearInterval(remotePollInterval);
      remotePollInterval = null;
    }
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    connectedAudioElements.clear();
    connectedStreamIds.clear();
  }

  return {
    initAudioMixer,
    connectRemoteAudioElements,
    initVAD,
    stopVAD,
    resetVADStats,
    cleanupMixer,
    isMicMuted: () => isLocalMicMuted,
    setManualMicMute: (muted) => {
      manualMicMuteOverride = !!muted;
      syncLocalMicState();
    },
    syncLocalMicState,
    getStats: () => ({
      activeSpeechDurationSec,
      silenceDurationSec,
      activeSpeechFormatted: `${Math.floor(activeSpeechDurationSec / 60)}m ${Math.floor(activeSpeechDurationSec % 60)}s`
    })
  };
});
