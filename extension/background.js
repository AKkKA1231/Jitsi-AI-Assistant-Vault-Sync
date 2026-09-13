/**
 * Meeting Assistant Extension - Background Service Worker
 * Handles network requests to Gemini Multimodal Audio API to bypass page-level CSP
 * Supports streaming chunk port protocol to bypass Chrome's 64MiB sendMessage IPC limit
 */

// 1. One-shot message listener for standard operations
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GEMINI_TRANSCRIBE') {
    handleGeminiTranscription(request)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message || err.toString() }));
    return true; // Keep message channel open for async response
  }

  if (request.action === 'GEMINI_TRANSCRIBE_CHUNK') {
    handleGeminiChunkTranscription(request)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message || err.toString() }));
    return true;
  }

  if (request.action === 'GEMINI_SYNTHESIZE_SUMMARY') {
    handleGeminiSynthesizeSummary(request)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message || err.toString() }));
    return true;
  }

  if (request.action === 'DRIVE_UPLOAD_WEBHOOK') {
    handleDriveWebhookUpload(request)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message || err.toString() }));
    return true; // Keep message channel open for async response
  }
});

// 2. Persistent streaming port listener to bypass Chrome's 64MiB IPC limit
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'DRIVE_STREAM_UPLOAD') {
    console.log('[Background Service Worker] Connected to streaming upload port.');
    let uploadMeta = null;
    let audioChunks = [];
    let receivedBytes = 0;

    port.onMessage.addListener(async (msg) => {
      try {
        if (msg.type === 'START') {
          uploadMeta = msg.metadata;
          audioChunks = [];
          receivedBytes = 0;
          console.log(`[Background Upload Stream] Starting stream for ${uploadMeta.roomName || 'Meeting'}, expected total chunks: ${msg.totalSlices}`);
          port.postMessage({ type: 'ACK', index: -1 });
        } else if (msg.type === 'CHUNK') {
          audioChunks.push(msg.data);
          receivedBytes += (msg.data || '').length;
          port.postMessage({ type: 'ACK', index: msg.chunkIndex });
        } else if (msg.type === 'COMPLETE') {
          console.log(`[Background Upload Stream] All chunks received (${audioChunks.length} slices, ~${(receivedBytes / 1024 / 1024).toFixed(1)} MB). Reassembling...`);
          const fullAudioBase64 = audioChunks.join('');
          const payload = {
            ...uploadMeta.payload,
            audioBase64: fullAudioBase64
          };

          const uploadResult = await handleDriveWebhookUpload({
            webhookUrl: uploadMeta.webhookUrl,
            payload
          });

          port.postMessage({ type: 'SUCCESS', data: uploadResult });
        }
      } catch (err) {
        console.error('[Background Upload Stream] Error in stream processing:', err);
        port.postMessage({ type: 'ERROR', error: err.message || err.toString() });
      }
    });
  }
});

async function handleDriveWebhookUpload({ webhookUrl, payload }) {
  console.log('[Background Service Worker] Dispatching Webhook upload to Google Apps Script...');
  let cleanUrl = (webhookUrl || '').trim();
  if (!cleanUrl) {
    throw new Error('Google Apps Script Webhook URL is empty. Please enter your Webhook URL in Settings.');
  }

  // Auto-correct /dev or /edit URLs
  if (cleanUrl.endsWith('/dev')) {
    cleanUrl = cleanUrl.slice(0, -4) + '/exec';
  } else if (cleanUrl.endsWith('/edit')) {
    throw new Error('Invalid URL: Please use the deployed Web App URL (ending in /exec), not the project editor URL (/edit).');
  }

  // Streamline payload to avoid memory bloat
  const cleanPayload = {
    folderName: payload.folderName || 'Jitsi_Meetings',
    roomName: payload.roomName || 'Meeting',
    targetFolderId: payload.targetFolderId || '',
    audioFileName: payload.audioFileName || 'Meeting_Audio.webm',
    audioMimeType: payload.audioMimeType || 'audio/webm',
    audioBase64: payload.audioBase64 || payload.base64Audio || '',
    markdownFileName: payload.markdownFileName || payload.fileName || 'Meeting_Summary.md',
    markdownText: payload.markdownText || payload.fileContent || ''
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 50000);

  let res;
  try {
    res = await fetch(cleanUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8' // Avoid CORS preflight on GAS
      },
      body: JSON.stringify(cleanPayload),
      signal: controller.signal
    });
  } catch (netErr) {
    if (netErr.name === 'AbortError') {
      throw new Error('Google Apps Script request timed out (50s). The payload took too long for Apps Script to decode. Meeting notes and audio have been safely downloaded locally.');
    }
    throw netErr;
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await res.text().catch(() => '');

  // Check if request was redirected to Google login due to missing permissions
  if (res.url && res.url.includes('accounts.google.com')) {
    throw new Error('Google Apps Script Permission Error: Web App is not set to "Who has access: Anyone". Open script.google.com > Deploy > Manage deployments > Edit > set "Who has access" to "Anyone" > Deploy.');
  }

  if (!res.ok) {
    if (res.status === 400) {
      if (text.includes('ServiceLogin') || text.includes('accounts.google.com')) {
        throw new Error('Google Apps Script Permission Error: Web App is not set to "Who has access: Anyone". In script.google.com, click Deploy > Manage deployments > Edit > set "Who has access" to "Anyone" > Deploy.');
      }
      throw new Error('Google Apps Script returned HTTP 400. In script.google.com, ensure Web App is deployed with "Execute as: Me" and "Who has access: Anyone".');
    }
    throw new Error(`Google Apps Script returned HTTP ${res.status}${text ? ': ' + text.slice(0, 100) : ''}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (parseErr) {
    if (text && (text.includes('drive.google.com') || text.toLowerCase().includes('success'))) {
      return {
        success: true,
        folderUrl: text.includes('drive.google.com') ? text.trim() : 'https://drive.google.com/drive/my-drive',
        raw: text
      };
    }
    throw new Error(`Invalid JSON response from Apps Script: ${text ? text.slice(0, 150) : 'Empty response'}`);
  }

  // Handle all valid success indicators across different Apps Script implementations
  const isSuccessful =
    json && (
      json.success === true ||
      json.success === 'true' ||
      json.status === 'success' ||
      json.status === 'ok' ||
      json.result === 'success' ||
      json.result === 'ok' ||
      json.ok === true ||
      Boolean(json.folderId || json.folderUrl || json.notesUrl || json.audioUrl || json.fileUrl)
    );

  if (isSuccessful) {
    return {
      success: true,
      folderId: json.folderId || json.folder_id || json.id || '',
      folderUrl: json.folderUrl || json.folder_url || json.url || (json.folderId ? `https://drive.google.com/drive/folders/${json.folderId}` : 'https://drive.google.com/drive/my-drive'),
      notesUrl: json.notesUrl || json.notes_url || json.fileUrl || json.file_url || null,
      audioUrl: json.audioUrl || json.audio_url || null,
      raw: json
    };
  }

  // Extract real error message from json payload instead of generic fallback
  const detailedError =
    (typeof json.error === 'string' && json.error.trim()) ||
    (json.error && typeof json.error === 'object' && (json.error.message || JSON.stringify(json.error))) ||
    (typeof json.message === 'string' && json.message.trim()) ||
    (typeof json.details === 'string' && json.details.trim()) ||
    (typeof json.msg === 'string' && json.msg.trim()) ||
    (typeof json.err === 'string' && json.err.trim()) ||
    (json.status && json.status !== 'error' && json.status !== 'failed' ? `Status: ${json.status}` : null) ||
    `Apps Script returned unsuccessful status (${JSON.stringify(json)})`;

  throw new Error(detailedError);
}

const DEFAULT_GEMINI_KEY = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || ''; // use your Gemini Flash API key

// Active production models from Google (verified endpoints)
const ACTIVE_GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-2.0-flash-lite'
];

// Compatibility cascade for tests & fallbacks
const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-2.0-flash-lite',
  'gemini-3.6-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite'
];

async function fetchWithBackoff(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      const isTransient = response.status === 500 || 
                          response.status === 502 || 
                          response.status === 503 || 
                          response.status === 504 || 
                          response.status === 429;

      if (isTransient && attempt < maxRetries) {
        const delay = Math.min(6000, 1200 * Math.pow(1.8, attempt)); // ~1.2s, ~2.1s, ~3.8s
        console.warn(`[Gemini Background] HTTP ${response.status} (Transient Error) on attempt ${attempt + 1}/${maxRetries}. Retrying in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return response;
    } catch (networkErr) {
      if (attempt < maxRetries) {
        const delay = 1500 * (attempt + 1);
        console.warn(`[Gemini Background] Network error (${networkErr.message}). Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw networkErr;
    }
  }
}

async function handleGeminiTranscription({ apiKey, base64Audio, mimeType, roomName }) {
  const activeKey = apiKey || DEFAULT_GEMINI_KEY;
  if (!activeKey) {
    throw new Error('No Gemini API key provided. Please configure your API key in the extension settings.');
  }
  if (!base64Audio) {
    throw new Error('No audio data provided to transcribe.');
  }

  const promptText = `You are an expert executive meeting transcriber and secretary. 
Listen carefully to this entire meeting audio recording (${roomName || 'Meeting'}).

Produce a structured markdown output with the following exact sections:

## 📝 Verbatim Spoken Transcript
Write the full transcript of what was spoken by all participants with accurate timestamps and speaker identification (e.g. [00:05] Speaker 1: "...", [00:22] Speaker 2: "..."). Make sure all technical words, discussions, and decisions are accurately captured.

## 🎯 Key Decisions
List all key decisions, agreements, or conclusions made during the session as bullet points.

## ✅ Action Items & Owners
List all action items and tasks discussed, formatting each as a markdown checkbox with assigned owners and deadlines if mentioned (e.g. - [ ] Task description (Owner)).

## 📌 Executive Summary
A concise 2-3 sentence overview of the huddle/meeting.`;

  const payload = {
    contents: [
      {
        parts: [
          { text: promptText },
          {
            inlineData: {
              mimeType: mimeType || 'audio/webm',
              data: base64Audio
            }
          }
        ]
      }
    ]
  };

  let lastError = null;
  for (const model of ACTIVE_GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`;
      console.log(`[Gemini Background] Requesting transcription via ${model}...`);
      
      const response = await fetchWithBackoff(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Model ${model} returned (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        throw new Error(`Empty response from model ${model}`);
      }

      console.log(`[Gemini Background] Successfully transcribed via ${model}`);

      // Parse sections
      const extractedDecisions = [];
      const extractedActions = [];
      const lines = rawText.split('\n');
      let currentSection = '';

      for (const line of lines) {
        const low = line.toLowerCase();
        if (low.includes('key decision')) { currentSection = 'decisions'; continue; }
        if (low.includes('action item')) { currentSection = 'actions'; continue; }
        if (low.includes('verbatim') || low.includes('transcript')) { currentSection = 'transcript'; continue; }
        if (low.includes('executive summary')) { currentSection = 'summary'; continue; }

        const clean = line.replace(/^[\*\-\d\.\s\[\]x]+/, '').trim();
        if (clean && (line.trim().startsWith('-') || line.trim().startsWith('*') || /^\d+\./.test(line.trim()))) {
          if (currentSection === 'decisions') extractedDecisions.push(clean);
          if (currentSection === 'actions') extractedActions.push(clean);
        }
      }

      return {
        markdown: rawText,
        decisions: extractedDecisions.length ? extractedDecisions : ["Decisions extracted from Gemini AI audio analysis."],
        actions: extractedActions.length ? extractedActions : ["Review AI generated notes and audio recording."],
        transcriptText: rawText,
        modelUsed: model
      };
    } catch (err) {
      console.warn(`[Gemini Background] Model ${model} failed, checking next:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error('All Gemini transcription models failed.');
}

/**
 * Transcribes an individual 3-5 minute audio chunk
 */
async function handleGeminiChunkTranscription({ apiKey, base64Audio, mimeType, chunkIndex, totalChunks, startTime, endTime, roomName }) {
  const activeKey = apiKey || DEFAULT_GEMINI_KEY;
  if (!activeKey) {
    throw new Error('No Gemini API key provided.');
  }
  if (!base64Audio) {
    return { chunkIndex, transcript: '' };
  }

  const promptText = `You are a high-accuracy meeting transcriber.
This is Audio Segment #${chunkIndex + 1} of ${totalChunks} (Time window: ${startTime || '00:00'} - ${endTime || '00:00'}) for meeting room "${roomName || 'Meeting'}".
Transcribe this entire audio segment verbatim with speaker identification and timestamps.
Return ONLY the timestamped transcript text. Do not add conversational intro/outro.`;

  const payload = {
    contents: [
      {
        parts: [
          { text: promptText },
          {
            inlineData: {
              mimeType: mimeType || 'audio/webm',
              data: base64Audio
            }
          }
        ]
      }
    ]
  };

  let lastError = null;
  for (const model of ACTIVE_GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`;
      const response = await fetchWithBackoff(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Model ${model} returned (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const transcript = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { chunkIndex, transcript: transcript.trim(), modelUsed: model };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error(`Failed to transcribe chunk #${chunkIndex + 1}`);
}

/**
 * Synthesizes combined chunk transcripts into Executive Minutes
 */
async function handleGeminiSynthesizeSummary({ apiKey, fullTranscriptText, roomName }) {
  const activeKey = apiKey || DEFAULT_GEMINI_KEY;
  if (!activeKey) {
    throw new Error('No Gemini API key provided.');
  }

  const promptText = `You are an executive meeting secretary.
Below is the complete verbatim transcript from meeting "${roomName || 'Meeting'}".

Full Transcript:
${fullTranscriptText}

Based on this transcript, generate:
## 🎯 Key Decisions
- List every confirmed decision or consensus point.

## ✅ Action Items & Owners
- [ ] List each actionable task with owner and deadline if mentioned.

## 📌 Executive Summary
A crisp 3-sentence summary of the discussion.`;

  const payload = {
    contents: [{ parts: [{ text: promptText }] }]
  };

  let lastError = null;
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`;
      const response = await fetchWithBackoff(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Model ${model} returned (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const summaryText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      const extractedDecisions = [];
      const extractedActions = [];
      const lines = summaryText.split('\n');
      let currentSection = '';

      for (const line of lines) {
        const low = line.toLowerCase();
        if (low.includes('key decision')) { currentSection = 'decisions'; continue; }
        if (low.includes('action item')) { currentSection = 'actions'; continue; }

        const clean = line.replace(/^[\*\-\d\.\s\[\]x]+/, '').trim();
        if (clean && (line.trim().startsWith('-') || line.trim().startsWith('*') || /^\d+\./.test(line.trim()))) {
          if (currentSection === 'decisions') extractedDecisions.push(clean);
          if (currentSection === 'actions') extractedActions.push(clean);
        }
      }

      return {
        summaryMarkdown: summaryText,
        decisions: extractedDecisions.length ? extractedDecisions : ["Decisions extracted from meeting transcript."],
        actions: extractedActions.length ? extractedActions : ["Review meeting notes and follow up on deliverables."],
        modelUsed: model
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to synthesize summary.');
}
