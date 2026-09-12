/**
 * Jitsi AI Assistant - Recorder & Chunking Engine
 * Implements 5-second resilient slicing for Vault safety and 3-minute logical chunking
 * for high-speed parallel AI transcription.
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
  let recordedChunks = [];        // Raw 5-second blob chunks for recovery
  let speechSegments = [];        // Segment metadata
  let logicalSpeechBlocks = [];    // 3-minute aggregated audio blocks for parallel transcription
  let periodicCheckpointInterval = null;
  let recordingStartTime = null;

  const CHUNK_TIME_SLICE_MS = 5000;         // 5 seconds for resilient disk safety
  const LOGICAL_BLOCK_DURATION_SEC = 180;    // 3 minutes per parallel transcription block

  function isCurrentlyRecording() {
    return isRecording;
  }

  function getRecordedChunks() {
    return recordedChunks;
  }

  function getSpeechSegments() {
    return speechSegments;
  }

  function getLogicalBlocks() {
    // If there are recorded chunks not yet sealed into a block, seal the current active block
    sealCurrentLogicalBlock();
    return logicalSpeechBlocks;
  }

  let currentBlockChunks = [];
  let currentBlockStartTime = 0;

  function sealCurrentLogicalBlock() {
    if (currentBlockChunks.length > 0) {
      const blockIndex = logicalSpeechBlocks.length;
      const blockBlob = new Blob(currentBlockChunks, { type: 'audio/webm' });
      const durationSec = Math.round((currentBlockChunks.length * CHUNK_TIME_SLICE_MS) / 1000);
      const endSec = currentBlockStartTime + durationSec;

      const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

      logicalSpeechBlocks.push({
        index: blockIndex,
        startTime: formatTime(currentBlockStartTime),
        endTime: formatTime(endSec),
        durationSec: durationSec,
        blob: blockBlob,
        sizeKb: (blockBlob.size / 1024).toFixed(1),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });

      currentBlockStartTime = endSec;
      currentBlockChunks = [];
    }
  }

  async function startRecording({ mixedStream, onChunkCaptured, onVaultCheckpoint }) {
    recordedChunks = [];
    speechSegments = [];
    logicalSpeechBlocks = [];
    currentBlockChunks = [];
    currentBlockStartTime = 0;
    recordingStartTime = Date.now();

    const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(mixedStream, { mimeType });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 800) {
        recordedChunks.push(event.data);
        currentBlockChunks.push(event.data);

        const chunkIndex = recordedChunks.length;
        const chunkEntry = {
          id: `chunk_${chunkIndex}`,
          index: chunkIndex,
          blob: event.data,
          sizeKb: (event.data.size / 1024).toFixed(1),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        };
        speechSegments.push(chunkEntry);

        if (typeof onChunkCaptured === 'function') {
          onChunkCaptured(event.data, chunkEntry);
        }

        // Check if current 3-minute logical block is filled (180s = 36 chunks of 5s)
        const blockChunkLimit = Math.floor((LOGICAL_BLOCK_DURATION_SEC * 1000) / CHUNK_TIME_SLICE_MS);
        if (currentBlockChunks.length >= blockChunkLimit) {
          sealCurrentLogicalBlock();
          console.log(`[Recorder] Sealed 3-minute logical audio block #${logicalSpeechBlocks.length} for parallel AI processing.`);
        }
      }
    };

    // Resilient 5-second chunk slicing (essential for crash safety)
    mediaRecorder.start(5000);
    isRecording = true;

    // Start 3-minute periodic rolling checkpoint
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

  function stopRecording() {
    return new Promise((resolve) => {
      if (periodicCheckpointInterval) {
        clearInterval(periodicCheckpointInterval);
        periodicCheckpointInterval = null;
      }
      isRecording = false;

      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        const handleStop = () => {
          try { mediaRecorder.removeEventListener('stop', handleStop); } catch (e) {}
          sealCurrentLogicalBlock();
          resolve();
        };
        mediaRecorder.addEventListener('stop', handleStop);
        try { mediaRecorder.requestData(); } catch (e) {}
        try { mediaRecorder.stop(); } catch (e) {
          sealCurrentLogicalBlock();
          resolve();
        }
      } else {
        sealCurrentLogicalBlock();
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
    LOGICAL_BLOCK_DURATION_SEC
  };
});
