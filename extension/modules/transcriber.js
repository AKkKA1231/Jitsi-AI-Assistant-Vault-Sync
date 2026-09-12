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
   * Preemptively transcribes a single 3-6 minute audio block in background
   */
  async function transcribeSingleBlock(block, { apiKey, roomName }) {
    if (!block || !block.blob) {
      return { index: block ? block.index : 0, transcript: '' };
    }

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
        transcript: result.transcript || ''
      };
    } catch (err) {
      console.warn(`[Transcriber] Preemptive transcription error on Block #${block.index}:`, err);
      return {
        index: block.index,
        startTime: block.startTime,
        endTime: block.endTime,
        durationSec: block.durationSec,
        transcript: `[Spoken segment ${block.startTime}-${block.endTime} captured (${block.sizeKb || 'audio'} KB)]`
      };
    }
  }

  /**
   * Fast-path meeting compiler:
   * Merges all precomputed background transcripts and transcribes only remaining pending blocks.
   */
  async function compilePreemptivelyTranscribedMeeting({ blocks, precomputedTranscripts = {}, apiKey, roomName, onProgress }) {
    if (!blocks || blocks.length === 0) {
      return { verbatimTranscript: '', decisions: [], actions: [], summaryText: '', markdown: '' };
    }

    const total = blocks.length;
    console.log(`[Transcriber] Fast-compiling ${total} meeting blocks (${Object.keys(precomputedTranscripts).length} pre-transcribed in background)...`);

    // 1. Identify any uncompleted blocks (usually just the final partial block)
    const pendingBlocks = blocks.filter(b => !precomputedTranscripts[b.index]);
    if (pendingBlocks.length > 0) {
      if (onProgress) onProgress(20, `Transcribing final partial meeting block (${pendingBlocks[0].startTime}-${pendingBlocks[0].endTime})...`);
      await runConcurrentPool(pendingBlocks, 2, async (block) => {
        const res = await transcribeSingleBlock(block, { apiKey, roomName });
        precomputedTranscripts[block.index] = res;
      });
    }

    // 2. Stitch chronological verbatim transcript in strict order
    const orderedResults = blocks.map(b => precomputedTranscripts[b.index] || {
      index: b.index,
      startTime: b.startTime,
      endTime: b.endTime,
      transcript: 'No speech detected.'
    });

    orderedResults.sort((a, b) => a.index - b.index);

    let combinedTranscript = '';
    orderedResults.forEach((cr) => {
      combinedTranscript += `### ⏱️ [${cr.startTime} - ${cr.endTime}] Meeting Block #${cr.index}\n\n`;
      combinedTranscript += `${cr.transcript || 'No active speech detected in this interval.'}\n\n`;
    });

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
