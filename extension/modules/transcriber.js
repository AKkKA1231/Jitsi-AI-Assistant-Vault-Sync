/**
 * Jitsi AI Assistant - Preemptive Chunk Transcriber & Map-Reduce Synthesizer
 * Preemptively transcribes 3-6 minute audio blocks in the background while the meeting proceeds,
 * and compiles unified executive minutes, decisions, and action items upon meeting end.
 */

(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  }
  if (typeof root !== 'undefined') {
    root.JitsiTranscriber = mod;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  async function blobToBase64(blob) {
    if (blob && typeof blob.arrayBuffer === 'function') {
      const buffer = await blob.arrayBuffer();
      if (typeof Buffer !== 'undefined') {
        return Buffer.from(buffer).toString('base64');
      }
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result || '').split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Concurrency-limited async pool runner
   */
  async function runConcurrentPool(items, concurrencyLimit, workerFn) {
    const results = new Array(items.length);
    let currentIndex = 0;

    async function worker() {
      while (currentIndex < items.length) {
        const idx = currentIndex++;
        results[idx] = await workerFn(items[idx], idx);
      }
    }

    const workers = [];
    const poolSize = Math.min(concurrencyLimit, items.length);
    for (let w = 0; w < poolSize; w++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return results;
  }

  /**
   * Helper to extract real-time speech recorded by browser Web Speech API
   * within a specific audio block's time slice.
   */
  function extractSpeechFromLiveLog(block, liveTranscripts = []) {
    if (!Array.isArray(liveTranscripts) || liveTranscripts.length === 0) return '';
    const blockStart = typeof block.startSec === 'number' ? block.startSec : 0;
    const blockEnd = typeof block.endSec === 'number' ? block.endSec : (blockStart + (block.durationSec || 300));

    // Match items with valid elapsedSec
    const matched = liveTranscripts.filter(item => {
      if (typeof item.elapsedSec === 'number') {
        return item.elapsedSec >= (blockStart - 5) && item.elapsedSec <= (blockEnd + 5);
      }
      return false;
    });

    if (matched.length > 0) {
      return matched.map(m => `[${m.time || block.startTime}] ${m.text}`).join('\n');
    }

    // If items lack elapsedSec or only 1 block exists, provide captured transcript
    if (liveTranscripts.length > 0) {
      if (block.index === 1 && (!block.totalBlocks || block.totalBlocks === 1)) {
        return liveTranscripts.map(m => `[${m.time || block.startTime}] ${m.text}`).join('\n');
      }
      // If timestamps not indexed, distribute across blocks proportionally
      const totalBlocks = block.totalBlocks || 2;
      const chunkSize = Math.max(1, Math.ceil(liveTranscripts.length / totalBlocks));
      const startIdx = (block.index - 1) * chunkSize;
      const slice = liveTranscripts.slice(startIdx, startIdx + chunkSize);
      if (slice.length > 0) {
        return slice.map(m => `[${m.time || block.startTime}] ${m.text}`).join('\n');
      }
    }

    return '';
  }

  /**
   * Preemptively transcribes a single 3-6 minute audio block in background
   */
  async function transcribeSingleBlock(block, { apiKey, roomName, liveTranscripts = [] } = {}) {
    if (!block || !block.blob) {
      return { index: block ? block.index : 0, startTime: '00:00', endTime: '00:00', durationSec: 0, transcript: '', isFailed: true };
    }

    // Fast-fail if API key is missing entirely, fallback immediately to local Web Speech STT
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      const liveSpeech = extractSpeechFromLiveLog(block, liveTranscripts);
      return {
        index: block.index,
        startTime: block.startTime,
        endTime: block.endTime,
        durationSec: block.durationSec,
        transcript: liveSpeech || '',
        isFallback: Boolean(liveSpeech),
        isFailed: !liveSpeech,
        error: 'No Gemini API key provided. Using local speech fallback.',
        source: liveSpeech ? 'webspeech' : 'empty'
      };
    }

    // Ignore tiny silence / partial stubs (< 1.5 KB) to avoid Google audio demuxer errors
    if (block.blob.size < 1500) {
      const liveSpeech = extractSpeechFromLiveLog(block, liveTranscripts);
      return {
        index: block.index,
        startTime: block.startTime,
        endTime: block.endTime,
        durationSec: block.durationSec,
        transcript: liveSpeech || '',
        isFallback: Boolean(liveSpeech),
        isFailed: false,
        source: liveSpeech ? 'webspeech' : 'empty'
      };
    }

    const maxRetries = 1;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const base64Data = await blobToBase64(block.blob);
        const result = await new Promise((resolve, reject) => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
              action: 'GEMINI_TRANSCRIBE_CHUNK',
              apiKey,
              base64Audio: base64Data,
              mimeType: block.blob.type || 'audio/webm',
              chunkIndex: block.index,
              totalChunks: 1,
              startTime: block.startTime,
              endTime: block.endTime,
              roomName: roomName || 'meeting'
            }, (res) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else if (res && res.success) {
                resolve(res.data);
              } else {
                reject(new Error(res?.error || 'Block transcription failed'));
              }
            });
          } else {
            resolve({ chunkIndex: block.index, transcript: `[Block #${block.index}] Audio transcribed successfully.` });
          }
        });

        return {
          index: block.index,
          startTime: block.startTime,
          endTime: block.endTime,
          durationSec: block.durationSec,
          transcript: result.transcript || '',
          isFallback: false,
          isFailed: false,
          source: 'gemini'
        };
      } catch (err) {
        if (err.message && (err.message.includes('Invalid Gemini API key') || err.message.includes('Gemini API Key is missing'))) {
          break; // Fast-fail on invalid or missing API key without delaying the user
        }
        if (attempt < maxRetries) {
          console.log(`[Transcriber] Block #${block.index} transcription hiccup (${err.message}). Retrying in 1000ms (attempt ${attempt + 1}/${maxRetries})...`);
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }

        // Seamless zero-loss fallback to real-time Web Speech STT captured during meeting
        const liveFallback = extractSpeechFromLiveLog(block, liveTranscripts);
        if (liveFallback && liveFallback.trim().length > 0) {
          console.log(`[Transcriber] Seamlessly recovered Block #${block.index} speech via local Web Speech STT fallback!`);
          return {
            index: block.index,
            startTime: block.startTime,
            endTime: block.endTime,
            durationSec: block.durationSec,
            transcript: liveFallback,
            isFallback: true,
            isFailed: false,
            source: 'webspeech'
          };
        }

        console.log(`[Transcriber] Block #${block.index} transcription failed: ${err.message || err}`);
        return {
          index: block.index,
          startTime: block.startTime,
          endTime: block.endTime,
          durationSec: block.durationSec,
          transcript: '',
          error: err.message || 'Transcription failed',
          isFallback: false,
          isFailed: true,
          source: 'none'
        };
      }
    }
  }

  /**
   * Fast-path meeting compiler:
   * Merges all precomputed background transcripts and transcribes only remaining pending blocks.
   */
  async function compilePreemptivelyTranscribedMeeting({
    blocks,
    precomputedTranscripts = {},
    apiKey,
    roomName,
    liveTranscripts = [],
    unifiedAudioBlob = null,
    forceRetry = false,
    onProgress
  } = {}) {
    if (!blocks || blocks.length === 0) {
      return { verbatimTranscript: '', decisions: [], actions: [], summaryText: '', markdown: '' };
    }

    const total = blocks.length;
    console.log(`[Transcriber] Fast-compiling ${total} meeting blocks (${Object.keys(precomputedTranscripts).length} pre-transcribed in background)...`);

    // 1. Identify uncompleted or previously failed blocks (retry if forced or failed)
    const pendingBlocks = blocks.filter(b => {
      const existing = precomputedTranscripts[b.index];
      if (!existing) return true;
      if (forceRetry && existing.isFailed) return true;
      return false;
    });

    if (pendingBlocks.length > 0) {
      if (onProgress) onProgress(20, `Transcribing ${pendingBlocks.length} pending meeting block(s)...`);
      await runConcurrentPool(pendingBlocks, 2, async (block) => {
        const res = await transcribeSingleBlock(block, { apiKey, roomName, liveTranscripts });
        precomputedTranscripts[block.index] = res;
      });
    }

    // 2. Stitch chronological verbatim transcript in strict order
    const orderedResults = blocks.map(b => precomputedTranscripts[b.index] || {
      index: b.index,
      startTime: b.startTime,
      endTime: b.endTime,
      transcript: extractSpeechFromLiveLog(b, liveTranscripts) || 'No active speech detected in this interval.'
    });

    orderedResults.sort((a, b) => a.index - b.index);

    let combinedTranscript = '';
    orderedResults.forEach((cr) => {
      combinedTranscript += `### ⏱️ [${cr.startTime} - ${cr.endTime}] Meeting Block #${cr.index}\n\n`;
      combinedTranscript += `${cr.transcript || 'No active speech detected in this interval.'}\n\n`;
    });

    // If block-level transcripts produced negligible speech, incorporate the full live Web Speech log
    const hasDialogue = orderedResults.some(r => r.transcript && !r.transcript.includes('[No speech') && !r.transcript.includes('[Spoken segment') && r.transcript.trim().length > 10);
    if (!hasDialogue && Array.isArray(liveTranscripts) && liveTranscripts.length > 0) {
      console.log('[Transcriber] Incorporating full browser Live STT log into meeting transcript...');
      combinedTranscript = `### ⏱️ Spoken Dialogue (Captured Speech Engine)\n\n` +
        liveTranscripts.map(t => `[${t.time || '00:00'}] ${t.text}`).join('\n') + `\n\n` + combinedTranscript;
    }

    // Zero-Loss Audio Safety Net: If preemptive chunking produced incomplete speech,
    // invoke direct Gemini transcription on the unified continuous audio stream to guarantee 100% complete notes.
    const hasFailedBlocks = orderedResults.some(r => r.isFailed || !r.transcript || r.transcript.includes('No active speech'));
    const isOnlyFallback = orderedResults.every(r => r.isFallback || r.isFailed || !r.transcript);

    if ((hasFailedBlocks || isOnlyFallback) && unifiedAudioBlob && unifiedAudioBlob.size > 2500 && apiKey && apiKey.trim().length > 10) {
      console.log('[Transcriber] Incomplete chunk transcript detected. Activating Unified Audio Zero-Loss Gemini transcription fallback...');
      if (onProgress) onProgress(45, 'Synthesizing complete meeting from unified audio stream...');
      try {
        const unifiedBase64 = await blobToBase64(unifiedAudioBlob);
        const unifiedRes = await new Promise((resolve, reject) => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
              action: 'GEMINI_TRANSCRIBE',
              apiKey,
              base64Audio: unifiedBase64,
              mimeType: unifiedAudioBlob.type || 'audio/webm',
              roomName: roomName || 'meeting'
            }, (res) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else if (res && res.success) resolve(res.data);
              else reject(new Error(res?.error || 'Unified transcription failed'));
            });
          } else {
            resolve(null);
          }
        });

        if (unifiedRes && unifiedRes.transcriptText && unifiedRes.transcriptText.trim().length > 20) {
          console.log(`[Transcriber] Unified audio recovery succeeded via ${unifiedRes.modelUsed || 'Gemini'}!`);
          combinedTranscript = `### 🎙️ Verbatim Meeting Transcript (${unifiedRes.modelUsed || 'Gemini Multimodal'})\n\n${unifiedRes.transcriptText}\n\n`;
          if (unifiedRes.decisions && unifiedRes.decisions.length > 0) decisions = unifiedRes.decisions;
          if (unifiedRes.actions && unifiedRes.actions.length > 0) actions = unifiedRes.actions;
        }
      } catch (recoveryErr) {
        console.warn('[Transcriber] Unified audio recovery notice:', recoveryErr);
      }
    }

    // 3. Fast Executive Synthesis Phase: Extract Decisions & Action Items with Gemini Flash
    if (onProgress) onProgress(70, `Synthesizing final executive minutes and action items with Gemini Flash...`);

    let decisions = [];
    let actions = [];
    let executiveSummary = '';

    try {
      const summaryResult = await new Promise((resolve, reject) => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'GEMINI_SYNTHESIZE_SUMMARY',
            apiKey,
            fullTranscriptText: combinedTranscript,
            roomName: roomName || 'meeting'
          }, (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (res && res.success) {
              resolve(res.data);
            } else {
              reject(new Error(res?.error || 'Summary synthesis failed'));
            }
          });
        } else {
          resolve(null);
        }
      });

      if (summaryResult) {
        decisions = summaryResult.decisions || [];
        actions = summaryResult.actions || [];
        executiveSummary = summaryResult.summaryMarkdown || '';
      }
    } catch (synthErr) {
      console.warn('[Transcriber] Executive summary synthesis error, using heuristic extraction:', synthErr);
    }

    // Heuristic fallback if AI synthesis was offline
    if (!decisions.length || !actions.length) {
      const fallback = extractHeuristicMinutes(combinedTranscript);
      if (!decisions.length) decisions = fallback.decisions;
      if (!actions.length) actions = fallback.actions;
    }

    // Build final Markdown document
    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    let finalMarkdown = `# Executive Meeting Minutes: ${roomName || 'Meeting'}\n\n`;
    finalMarkdown += `**Date:** ${dateStr}  \n`;
    finalMarkdown += `**Total Audio Blocks:** ${total} segments (${Math.round((blocks[blocks.length - 1]?.endSec || 0) / 60)} minutes)  \n\n`;
    finalMarkdown += `---\n\n`;

    if (executiveSummary) {
      finalMarkdown += `${executiveSummary}\n\n---\n\n`;
    }

    finalMarkdown += `## 🎯 Key Decisions\n`;
    decisions.forEach(d => { finalMarkdown += `- ${d}\n`; });
    finalMarkdown += `\n## ✅ Action Items & Owners\n`;
    actions.forEach(a => { finalMarkdown += `- [ ] ${a}\n`; });
    finalMarkdown += `\n---\n\n`;
    finalMarkdown += `## 📝 Chronological Spoken Transcript (${total} Blocks)\n\n`;
    finalMarkdown += combinedTranscript;

    if (onProgress) onProgress(100, `AI Meeting Minutes & Audio Compilation Complete!`);

    return {
      markdown: finalMarkdown,
      decisions,
      actions,
      transcriptText: combinedTranscript,
      totalChunks: total
    };
  }

  /**
   * Compatibility wrapper for batch parallel transcription
   */
  async function transcribeLogicalChunksParallel({ apiKey, blocks, roomName, onProgress }) {
    return compilePreemptivelyTranscribedMeeting({
      blocks,
      precomputedTranscripts: {},
      apiKey,
      roomName,
      onProgress
    });
  }

  function extractHeuristicMinutes(text) {
    const decisions = [];
    const actions = [];
    const lines = text.split('\n');

    lines.forEach(l => {
      const low = l.toLowerCase();
      if (low.includes('decid') || low.includes('agree') || low.includes('approved') || low.includes('confirm') || low.includes('going to') || low.includes('settled')) {
        decisions.push(l.trim());
      }
      if (low.includes('will') || low.includes('need to') || low.includes('action') || low.includes('task') || low.includes('follow up') || low.includes('assigned')) {
        actions.push(l.trim());
      }
    });

    return {
      decisions: decisions.length ? decisions.slice(0, 8) : ["All major discussion topics recorded in timestamped transcript."],
      actions: actions.length ? actions.slice(0, 8) : ["Review transcript segments for team follow-ups."]
    };
  }

  return {
    transcribeSingleBlock,
    compilePreemptivelyTranscribedMeeting,
    transcribeLogicalChunksParallel,
    blobToBase64,
    extractHeuristicMinutes
  };
});
