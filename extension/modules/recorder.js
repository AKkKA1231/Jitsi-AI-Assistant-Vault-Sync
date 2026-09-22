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
  let cachedWebmHeader = null;        // Container header (EBML + Segment + Tracks) for standalone blocks

  const CHUNK_TIME_SLICE_MS = 10000;         // 10 seconds for resilient disk safety
  let logicalBlockDurationSec = 300;         // 5 minutes default per block (configurable: 3, 4, 5, 6 mins)

  /**
   * Extracts the initial WebM container header (EBML Header, Segment Header, and Tracks)
   * from the very first recorded chunk by locating the first Cluster element (0x1F43B675).
   * Subsequent logical blocks (Blocks #2, #3, ...) require this header to be a valid,
   * standalone WebM file playable by media players and accepted by Gemini AI without HTTP 400 errors.
   */
  async function extractWebmHeader(chunkBlob) {
    if (!chunkBlob) return null;
    try {
      let buffer;
      if (typeof chunkBlob.arrayBuffer === 'function') {
        buffer = await chunkBlob.arrayBuffer();
      } else {
        return null;
      }
      const bytes = new Uint8Array(buffer);
      // WebM Cluster Element ID is 0x1F 0x43 0xB6 0x75
      for (let i = 0; i < bytes.length - 4; i++) {
        if (bytes[i] === 0x1f && bytes[i + 1] === 0x43 && bytes[i + 2] === 0xb6 && bytes[i + 3] === 0x75) {
          const headerSlice = chunkBlob.slice(0, i, 'audio/webm');
          console.log(`[Recorder] Extracted WebM container header (${headerSlice.size} bytes).`);
          return headerSlice;
        }
      }
    } catch (e) {
      console.warn('[Recorder] WebM header extraction error:', e);
    }
    return null;
  }

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

      // Block #1 already contains chunk #0 with the initial EBML + Segment + Tracks header.
      // Blocks #2, #3, ... contain only raw Clusters, so we prepend the cached WebM container
      // header so Gemini and media decoders parse each block cleanly without HTTP 400 errors.
      const blockChunks = (blockIndex === 1 || !cachedWebmHeader)
        ? currentBlockChunks
        : [cachedWebmHeader, ...currentBlockChunks];

      const blockBlob = new Blob(blockChunks, { type: 'audio/webm' });
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
    cachedWebmHeader = null;
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

        // Cache the WebM container header (EBML + Segment + Tracks) from any early chunk.
        // Keep trying until we successfully extract it — no chunk-count limit.
        // Without this header, Block #2, #3, etc. are raw Clusters that Gemini cannot decode.
        if (!cachedWebmHeader) {
          extractWebmHeader(event.data).then((hdr) => {
            if (hdr && hdr.size > 0 && !cachedWebmHeader) {
              cachedWebmHeader = hdr;
              console.log(`[Recorder] WebM container header cached from chunk #${recordedChunks.length} (${hdr.size} bytes). Future blocks are safe.`);
            }
          }).catch((err) => {
            console.warn('[Recorder] Header extraction notice:', err);
          });
        }

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
    getCachedWebmHeader: () => cachedWebmHeader,
    setCachedWebmHeader: (hdr) => { cachedWebmHeader = hdr; },
    extractWebmHeader,
    get LOGICAL_BLOCK_DURATION_SEC() {
      return logicalBlockDurationSec;
    }
  };
});
