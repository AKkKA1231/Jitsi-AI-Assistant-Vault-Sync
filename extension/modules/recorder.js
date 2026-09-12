/**
 * Jitsi AI Assistant - Recorder & Chunking Engine
 * Implements 10-second resilient slicing for Vault safety and 3-6 minute logical chunking
 * for preemptive background AI transcription and seamless meeting-end compilation.
 */

(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  }
  if (typeof root !== 'undefined') {
    root.JitsiRecorder = mod;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  let mediaRecorder = null;
  let isRecording = false;
  let recordedChunks = [];        // Raw 10-second blob chunks for recovery
  let speechSegments = [];        // Segment metadata
  let logicalSpeechBlocks = [];   // 3-6 minute aggregated audio blocks for preemptive transcription
  let periodicCheckpointInterval = null;
  let recordingStartTime = null;

  const CHUNK_TIME_SLICE_MS = 10000;         // 10 seconds for resilient disk safety
  let logicalBlockDurationSec = 300;         // 5 minutes default per block (configurable: 3, 4, 5, 6 mins)

  function isCurrentlyRecording() {
    return isRecording;
  }

  function getRecordedChunks() {
    return recordedChunks;
  }

  function getSpeechSegments() {
    return speechSegments;
  }

  function setBlockDuration(minutes) {
    const mins = Number(minutes) || 5;
    logicalBlockDurationSec = Math.max(180, Math.min(360, mins * 60));
    console.log(`[Recorder] Set logical chunk duration to ${Math.round(logicalBlockDurationSec / 60)} minutes (${logicalBlockDurationSec}s).`);
  }

  function getBlockDurationMinutes() {
    return Math.round(logicalBlockDurationSec / 60);
  }

  function getLogicalBlocks() {
    return logicalSpeechBlocks;
  }

  let currentBlockChunks = [];
  let currentBlockStartTime = 0;

  function sealCurrentLogicalBlock(callback) {
    if (currentBlockChunks.length > 0) {
      const blockIndex = logicalSpeechBlocks.length + 1; // 1-indexed for display
      const blockBlob = new Blob(currentBlockChunks, { type: 'audio/webm' });
      const durationSec = Math.round((currentBlockChunks.length * CHUNK_TIME_SLICE_MS) / 1000);
      const endSec = currentBlockStartTime + durationSec;

      const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

      const blockEntry = {
        id: `block_${blockIndex}`,
        index: blockIndex,
        startTime: formatTime(currentBlockStartTime),
        endTime: formatTime(endSec),
        startSec: currentBlockStartTime,
        endSec: endSec,
        durationSec: durationSec,
        blob: blockBlob,
        sizeKb: (blockBlob.size / 1024).toFixed(1),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      logicalSpeechBlocks.push(blockEntry);
      currentBlockStartTime = endSec;
      currentBlockChunks = [];

      if (typeof callback === 'function') {
        callback(blockEntry);
      }
      return blockEntry;
    }
    return null;
  }

  async function startRecording({ mixedStream, onChunkCaptured, onBlockSealed, onBlockProgress, onVaultCheckpoint }) {
    recordedChunks = [];
    speechSegments = [];
    logicalSpeechBlocks = [];
    currentBlockChunks = [];
    currentBlockStartTime = 0;
    recordingStartTime = Date.now();

    const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    // Voice-optimized Opus profile: 32 kbps mono gives pristine speech clarity with 85% lighter file size!
    const recorderOptions = {
      mimeType,
      audioBitsPerSecond: 32000
    };

    try {
      mediaRecorder = new MediaRecorder(mixedStream, recorderOptions);
    } catch (e) {
      // Fallback for browsers with strict bitrate option checks
      mediaRecorder = new MediaRecorder(mixedStream, { mimeType });
    }

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 500) {
        recordedChunks.push(event.data);
        currentBlockChunks.push(event.data);

        const chunkIndex = recordedChunks.length;
        const chunkEntry = {
          id: `slice_${chunkIndex}`,
          index: chunkIndex,
          blob: event.data,
          sizeKb: (event.data.size / 1024).toFixed(1),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        };
        speechSegments.push(chunkEntry);

        // Safe 10-second vault append
        if (typeof onChunkCaptured === 'function') {
          onChunkCaptured(event.data, chunkEntry);
        }

        // Real-time progress update for the active block card
        const currentBlockIndex = logicalSpeechBlocks.length + 1;
        const currentElapsedSec = Math.round((currentBlockChunks.length * CHUNK_TIME_SLICE_MS) / 1000);
        if (typeof onBlockProgress === 'function') {
          onBlockProgress({
            blockIndex: currentBlockIndex,
            elapsedSec: currentElapsedSec,
            totalSec: logicalBlockDurationSec,
            startSec: currentBlockStartTime
          });
        }

        // Check if current 3-6 minute logical block is filled
        const blockChunkLimit = Math.floor((logicalBlockDurationSec * 1000) / CHUNK_TIME_SLICE_MS);
        if (currentBlockChunks.length >= blockChunkLimit) {
          const sealed = sealCurrentLogicalBlock(onBlockSealed);
          console.log(`[Recorder] Sealed ${Math.round(logicalBlockDurationSec / 60)}-minute logical audio block #${sealed.index} for preemptive AI transcription.`);
        }
      }
    };

    // Resilient 10-second chunk slicing
    mediaRecorder.start(CHUNK_TIME_SLICE_MS);
    isRecording = true;

    // Start periodic rolling checkpoint (every 3 minutes)
    if (periodicCheckpointInterval) clearInterval(periodicCheckpointInterval);
    periodicCheckpointInterval = setInterval(() => {
      if (!isRecording) return;
      try {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.requestData();
        }
        if (typeof onVaultCheckpoint === 'function') {
          onVaultCheckpoint(recordedChunks);
        }
      } catch (err) {
        console.warn('[Recorder] Periodic checkpoint error:', err);
      }
    }, 3 * 60 * 1000);

    return true;
  }

  function stopRecording(onBlockSealed) {
    return new Promise((resolve) => {
      if (periodicCheckpointInterval) {
        clearInterval(periodicCheckpointInterval);
        periodicCheckpointInterval = null;
      }
      isRecording = false;

      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        const handleStop = () => {
          try { mediaRecorder.removeEventListener('stop', handleStop); } catch (e) {}
          sealCurrentLogicalBlock(onBlockSealed);
          resolve();
        };
        mediaRecorder.addEventListener('stop', handleStop);
        try { mediaRecorder.requestData(); } catch (e) {}
        try { mediaRecorder.stop(); } catch (e) {
          sealCurrentLogicalBlock(onBlockSealed);
          resolve();
        }
      } else {
        sealCurrentLogicalBlock(onBlockSealed);
        resolve();
      }
    });
  }

  function compileUnifiedAudio() {
    if (!recordedChunks || recordedChunks.length === 0) {
      return null;
    }
    return new Blob(recordedChunks, { type: 'audio/webm' });
  }

  return {
    startRecording,
    stopRecording,
    compileUnifiedAudio,
    isCurrentlyRecording,
    getRecordedChunks,
    getSpeechSegments,
    getLogicalBlocks,
    setBlockDuration,
    getBlockDurationMinutes,
    CHUNK_TIME_SLICE_MS,
    get LOGICAL_BLOCK_DURATION_SEC() {
      return logicalBlockDurationSec;
    }
  };
});
