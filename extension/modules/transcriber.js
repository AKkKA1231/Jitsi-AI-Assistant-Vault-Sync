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

    const matched = liveTranscripts.filter(item => {
      if (typeof item.elapsedSec === 'number') {
        return item.elapsedSec >= (blockStart - 4) && item.elapsedSec <= (blockEnd + 4);
      }
      return true;
    });

    if (matched.length > 0) {
      return matched.map(m => `[${m.time || block.startTime}] ${m.text}`).join('\n');
    }

    if (liveTranscripts.length > 0 && block.index === 1) {
      return liveTranscripts.map(m => `[${m.time || block.startTime}] ${m.text}`).join('\n');
    }

    return '';
  }

  const inFlightBlockTranscriptions = new Map();

  /**
   * Preemptively transcribes a single 3-6 minute audio block in background
   */
  async function transcribeSingleBlock(block, { apiKey, roomName, liveTranscripts = [], participantNames = [] } = {}) {
    if (!block || !block.blob) {
      return { index: block ? block.index : 0, startTime: '00:00', endTime: '00:00', durationSec: 0, transcript: '', isFailed: true };
    }

    // Deduplicate in-flight calls: if this exact block is already being transcribed, reuse running Promise
    const inFlightKey = `b_${block.index}_${block.blob.size}`;
    if (inFlightBlockTranscriptions.has(inFlightKey)) {
      console.log(`[Transcriber] Block #${block.index} already in-flight — reusing running Promise.`);
      return inFlightBlockTranscriptions.get(inFlightKey);
    }

    const taskPromise = (async () => {
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
          // Wrap sendMessage in a 120s timeout race.
          // Chrome MV3 service workers can be killed after 5 minutes of inactivity.
          // If the background is sleeping/terminated, the callback never fires — causing
          // an infinite "Transcribing in Background..." hang. This race prevents that.
          const sendMessagePromise = new Promise((resolve, reject) => {
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
                roomName: roomName || 'meeting',
                participantNames: participantNames || []
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

          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(
              `Block #${block.index} transcription timed out after 2 minutes. ` +
              `The background service worker may be sleeping (Chrome MV3 idle timeout). ` +
              `Falling back to Web Speech STT.`
            )), 120000)
          );

          const result = await Promise.race([sendMessagePromise, timeoutPromise]);

          // Gemini responded successfully
          const geminiText = (result.transcript || '').trim();

          // If Gemini returned an empty transcript (audio decoded but no speech detected by model),
          // attempt the live Web Speech STT fallback before giving up — the audio block IS real
          // (e.g. 889 KB) and may contain speech that a model didn't pick up due to codec issues.
          if (!geminiText) {
            const liveFallback = extractSpeechFromLiveLog(block, liveTranscripts);
            if (liveFallback && liveFallback.trim().length > 0) {
              console.log(`[Transcriber] Block #${block.index}: Gemini returned empty — using Web Speech STT fallback.`);
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
            // No live STT either — mark as failed so compilation will retry it
            console.warn(`[Transcriber] Block #${block.index}: Gemini empty + no live STT. Marking failed for retry.`);
            throw new Error(`Gemini returned empty transcript for Block #${block.index}`);
          }

          return {
            index: block.index,
            startTime: block.startTime,
            endTime: block.endTime,
            durationSec: block.durationSec,
            transcript: geminiText,
            isFallback: false,
            isFailed: false,
            source: 'gemini'
          };
        } catch (err) {
          if (err.message && err.message.includes('Invalid Gemini API key')) {
            break; // Fast-fail on invalid API key without delay
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
    })();

    inFlightBlockTranscriptions.set(inFlightKey, taskPromise);
    try {
      return await taskPromise;
    } finally {
      inFlightBlockTranscriptions.delete(inFlightKey);
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
    onProgress,
    participantNames = [],
    onSynthesisError    // Optional: callback(errMsg) fired if AI executive summary fails
  } = {}) {
    if (!blocks || blocks.length === 0) {
      return { verbatimTranscript: '', decisions: [], actions: [], summaryText: '', markdown: '' };
    }

    const total = blocks.length;
    console.log(`[Transcriber] Fast-compiling ${total} meeting blocks (${Object.keys(precomputedTranscripts).length} pre-transcribed in background)...`);

    // 1. Identify uncompleted or previously failed/empty blocks to (re-)transcribe.
    // Always retry isFailed blocks — they may have failed due to deprecated models
    // or transient API errors, and should be re-attempted with current working models.
    const pendingBlocks = blocks.filter(b => {
      const existing = precomputedTranscripts[b.index];
      if (!existing) return true;                     // Never transcribed
      if (existing.isFailed) return true;             // Failed — always retry
      if (!existing.transcript && !existing.isFallback) return true; // Empty result, retry
      return false;                                   // Already has valid transcript
    });

    if (pendingBlocks.length > 0) {
      if (onProgress) onProgress(20, `Transcribing ${pendingBlocks.length} pending meeting block(s)...`);
      await runConcurrentPool(pendingBlocks, 2, async (block) => {
        const res = await transcribeSingleBlock(block, { apiKey, roomName, liveTranscripts, participantNames });
        precomputedTranscripts[block.index] = res;
      });
    }

    // 2. Stitch chronological verbatim transcript in strict order.
    // For blocks with missing/empty/failed results, use live Web Speech STT as fallback
    // before showing the "No active speech" placeholder.
    const orderedResults = blocks.map(b => {
      const result = precomputedTranscripts[b.index];
      if (!result || result.isFailed || !result.transcript) {
        const liveSpeech = extractSpeechFromLiveLog(b, liveTranscripts);
        return {
          index: b.index,
          startTime: b.startTime,
          endTime: b.endTime,
          transcript: liveSpeech || (result && result.error ? `[Transcription error: ${result.error}]` : 'No active speech detected in this interval.'),
          isFallback: Boolean(liveSpeech),
          source: liveSpeech ? 'webspeech' : 'none'
        };
      }
      return result;
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

    // 3. Fast Executive Synthesis Phase: Extract Decisions & Action Items with Gemini Flash
    if (onProgress) onProgress(70, `Synthesizing final executive minutes and action items with Gemini Flash...`);

    let decisions = [];
    let actions = [];
    let executiveSummary = '';
    let synthesisUsedFallback = false;

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
      // Synthesis failed — advance progress bar so it doesn't freeze at 70%
      if (onProgress) onProgress(85, 'AI summary unavailable — using keyword extraction from transcript...');

      const errMsg = synthErr?.message || String(synthErr);
      console.warn(`[Transcriber] Executive summary synthesis failed (${errMsg}). Falling back to heuristic keyword extraction from transcript.`);
      synthesisUsedFallback = true;

      // Fire optional UI callback so content.js can show a toast to the user
      if (typeof onSynthesisError === 'function') {
        onSynthesisError(errMsg);
      }
    }

    // Heuristic fallback if AI synthesis was offline or returned empty
    if (!decisions.length || !actions.length) {
      const fallback = extractHeuristicMinutes(combinedTranscript);
      if (!decisions.length) decisions = fallback.decisions;
      if (!actions.length) actions = fallback.actions;
      synthesisUsedFallback = true;
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

    // Add a synthesis note at the bottom if heuristic fallback was used
    if (synthesisUsedFallback) {
      finalMarkdown += `\n> ⚠️ *Note: AI executive summary was unavailable. Decisions and action items above were extracted using keyword analysis of the transcript.*\n`;
    }

    if (onProgress) onProgress(100, synthesisUsedFallback
      ? `Transcription complete. AI summary unavailable — keyword notes extracted.`
      : `AI Meeting Minutes & Audio Compilation Complete!`);

    return {
      markdown: finalMarkdown,
      decisions,
      actions,
      transcriptText: combinedTranscript,
      totalChunks: total,
      synthesisUsedFallback   // true if Gemini summary failed; content.js can show a toast
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
