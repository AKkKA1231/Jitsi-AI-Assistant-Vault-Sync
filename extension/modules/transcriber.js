/**
 * Jitsi AI Assistant - Parallel Chunk Transcriber & Map-Reduce Synthesizer
 * Dispatches parallel Gemini Flash API calls across 3-minute audio chunks,
 * merges chronological transcripts, and synthesizes executive decisions and action items.
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
   * Dispatches parallel transcription calls across 3-minute logical chunks
   */
  async function transcribeLogicalChunksParallel({ apiKey, blocks, roomName, onProgress }) {
    if (!blocks || blocks.length === 0) {
      return { verbatimTranscript: '', decisions: [], actions: [], summaryText: '' };
    }

    const total = blocks.length;
    console.log(`[Transcriber] Starting parallel transcription across ${total} logical 3-min audio chunks...`);
    if (onProgress) onProgress(10, `Preparing ${total} parallel audio segments for Gemini Flash...`);

    // 1. Map Phase: Transcribe each 3-min chunk concurrently (concurrency = 3)
    let completedChunks = 0;
    const chunkResults = await runConcurrentPool(blocks, 3, async (block, idx) => {
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
              totalChunks: total,
              startTime: block.startTime,
              endTime: block.endTime,
              roomName
            }, (res) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else if (res && res.success) {
                resolve(res.data);
              } else {
                reject(new Error(res?.error || 'Chunk transcription failed'));
              }
            });
          } else {
            resolve({ chunkIndex: block.index, transcript: `[Segment #${block.index + 1}] Transcription in progress.` });
          }
        });

        completedChunks++;
        const pct = 10 + Math.round((completedChunks / total) * 60);
        if (onProgress) {
          onProgress(pct, `Transcribed segment ${completedChunks} of ${total} (${block.startTime}-${block.endTime})...`);
        }
        return {
          index: block.index,
          startTime: block.startTime,
          endTime: block.endTime,
          transcript: result.transcript || ''
        };
      } catch (err) {
        console.warn(`[Transcriber] Chunk #${block.index + 1} transcription error:`, err);
        completedChunks++;
        return {
          index: block.index,
          startTime: block.startTime,
          endTime: block.endTime,
          transcript: `[Audio Segment ${block.startTime}-${block.endTime} captured (${block.sizeKb} KB)]`
        };
      }
    });

    // 2. Reduce Phase: Stitch chronological verbatim transcript
    chunkResults.sort((a, b) => a.index - b.index);
    let combinedTranscript = '';
    chunkResults.forEach((cr) => {
      combinedTranscript += `### ⏱️ [${cr.startTime} - ${cr.endTime}] Meeting Segment #${cr.index + 1}\n\n`;
      combinedTranscript += `${cr.transcript || 'No active speech detected in this interval.'}\n\n`;
    });

    // 3. Synthesis Phase: Extract Executive Summary, Key Decisions, and Action Items
    if (onProgress) onProgress(75, `Synthesizing executive minutes, decisions, and action items with Gemini Flash...`);

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
            roomName
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
    let finalMarkdown = `# Executive Meeting Minutes: ${roomName}\n\n`;
    finalMarkdown += `**Date:** ${dateStr}  \n`;
    finalMarkdown += `**Total 3-Minute Chunks Processed:** ${total} segments  \n\n`;
    finalMarkdown += `---\n\n`;

    if (executiveSummary) {
      finalMarkdown += `${executiveSummary}\n\n---\n\n`;
    }

    finalMarkdown += `## 🎯 Key Decisions\n`;
    decisions.forEach(d => { finalMarkdown += `- ${d}\n`; });
    finalMarkdown += `\n## ✅ Action Items & Owners\n`;
    actions.forEach(a => { finalMarkdown += `- [ ] ${a}\n`; });
    finalMarkdown += `\n---\n\n`;
    finalMarkdown += `## 📝 Chronological Spoken Transcript (${total} Parallel Segments)\n\n`;
    finalMarkdown += combinedTranscript;

    if (onProgress) onProgress(100, `AI Transcription & synthesis completed!`);

    return {
      markdown: finalMarkdown,
      decisions,
      actions,
      transcriptText: combinedTranscript,
      totalChunks: total
    };
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
    transcribeLogicalChunksParallel,
    blobToBase64,
    extractHeuristicMinutes
  };
});
