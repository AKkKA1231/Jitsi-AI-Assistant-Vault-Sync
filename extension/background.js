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

  if (request.action === 'GEMINI_TEST_KEY' || request.type === 'GEMINI_TEST_KEY') {
    handleGeminiTestKey(request)
      .then(result => sendResponse({ success: true, data: result, model: result.modelUsed }))
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

  if (request.action === 'SLACK_SEND_NOTIFICATION') {
    handleSlackNotification(request)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message || err.toString() }));
    return true;
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
    folderName: payload.folderName || 'meetingRecords',
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
  const lowerText = text.toLowerCase();
  const isHtml = text.trim().startsWith('<') || text.includes('<!DOCTYPE') || text.includes('<html') || text.includes('<head');

  // Check if request was blocked by Google Apps Script permission or authorization barrier
  if (isHtml || (res.url && res.url.includes('accounts.google.com')) || lowerText.includes('servicelogin')) {
    if (lowerText.includes('authorization needed') || text.includes('Authorization needed')) {
      throw new Error('Google Apps Script Permission Error: Web App is not authorized or "Who has access" is not set to "Anyone". In script.google.com, click Deploy > Manage deployments > Edit > set "Who has access" to "Anyone" and ensure permissions are authorized.');
    }
    if (lowerText.includes('script function not found') || lowerText.includes('dopost')) {
      throw new Error('Google Apps Script Error: "doPost" function not found in script. Please ensure the Webhook code from the setup guide is pasted into script.google.com.');
    }
    if ((res.url && res.url.includes('accounts.google.com')) || lowerText.includes('servicelogin') || lowerText.includes('sign in')) {
      throw new Error('Google Apps Script Permission Error: Web App requires login. In script.google.com, click Deploy > Manage deployments > Edit > set "Who has access" to "Anyone" > Deploy.');
    }
    throw new Error('Google Apps Script returned an HTML page instead of JSON. Ensure your Web App is deployed with "Execute as: Me" and "Who has access: Anyone".');
  }

  if (!res.ok) {
    if (res.status === 400) {
      throw new Error('Google Apps Script returned HTTP 400. In script.google.com, ensure Web App is deployed with "Execute as: Me" and "Who has access: Anyone".');
    }
    throw new Error(`Google Apps Script returned HTTP ${res.status}${text ? ': ' + text.slice(0, 100) : ''}`);
  }

  const defaultFolderUrl = `https://drive.google.com/drive/search?q=${encodeURIComponent(payload?.folderName || 'meetingRecords')}`;

  let json;
  try {
    json = JSON.parse(text);
  } catch (parseErr) {
    if (text && (text.includes('drive.google.com') || text.toLowerCase().includes('success'))) {
      return {
        success: true,
        folderUrl: text.includes('drive.google.com') ? text.trim() : defaultFolderUrl,
        raw: text
      };
    }
    throw new Error(`Invalid response from Apps Script: ${text ? text.slice(0, 150) : 'Empty response'}`);
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
      folderUrl: json.folderUrl || json.folder_url || json.url || (json.folderId ? `https://drive.google.com/drive/folders/${json.folderId}` : defaultFolderUrl),
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

/**
 * Dispatches a formatted Block Kit notification with Google Drive link and AI notes to Slack Webhook
 */
async function handleSlackNotification({
  webhookUrl,
  roomName,
  folderUrl,
  notesUrl,
  audioUrl,
  decisions = [],
  actions = [],
  executiveSummary = '',
  durationStr = '',
  audioSizeKb = ''
}) {
  console.log('[Background Service Worker] Dispatching notification to Slack Webhook...');
  const cleanUrl = (webhookUrl || '').trim();
  if (!cleanUrl || !cleanUrl.startsWith('https://hooks.slack.com/')) {
    throw new Error('Invalid Slack Webhook URL. It must start with https://hooks.slack.com/');
  }

  const room = roomName || 'Meeting';
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const targetFolderUrl = folderUrl || 'https://drive.google.com/drive/search?q=meetingRecords';

  // Construct Block Kit message blocks
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🎙️ Meeting Notes: ${room}`,
        emoji: true
      }
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `📅 *${dateStr} at ${timeStr}* | ⏱️ Duration: *${durationStr || 'Completed'}* ${audioSizeKb ? `| 🎵 Audio: *${audioSizeKb} KB*` : ''}`
        }
      ]
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Google Drive Meeting Folder:*\n<${targetFolderUrl}|📂 View All Meeting Files in Google Drive>`
      },
      accessory: {
        type: 'button',
        text: {
          type: 'plain_text',
          text: '📂 Open in Drive',
          emoji: true
        },
        url: targetFolderUrl,
        style: 'primary',
        action_id: 'open_drive_folder'
      }
    },
    {
      type: 'divider'
    }
  ];

  if (executiveSummary && executiveSummary.trim()) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📌 Executive Summary:*\n${executiveSummary.trim().slice(0, 500)}`
      }
    });
  }

  if (Array.isArray(decisions) && decisions.length > 0) {
    const decisionList = decisions.slice(0, 6).map(d => `• ${d.replace(/^[\\*\\-\\s]+/, '')}`).join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🎯 Key Decisions:*\n${decisionList}`
      }
    });
  }

  if (Array.isArray(actions) && actions.length > 0) {
    const actionList = actions.slice(0, 6).map(a => `☐ ${a.replace(/^[\\*\\-\\s\\[\\]x]+/, '')}`).join('\n');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*✅ Action Items:*\n${actionList}`
      }
    });
  }

  const payload = {
    text: `🎙️ Meeting Notes for ${room}: <${targetFolderUrl}|View in Google Drive>`,
    blocks
  };

  const response = await fetch(cleanUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Slack Webhook returned HTTP ${response.status}: ${errBody || response.statusText}`);
  }

  return { success: true, timestamp: Date.now() };
}

const DEFAULT_GEMINI_KEY = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || ''; // use your Gemini Flash API key

// Active production models from Google with verified lifetime free tier multimodal audio support
// gemini-3.1-flash-lite is prioritized as the most durable, lowest-503 model for high-throughput speech audio
// Retired/shut-down models (gemini-1.5-flash, gemini-1.5-flash-8b, gemini-2.0-flash, gemini-2.0-flash-lite, gemini-2.5-flash) have been removed.
const ACTIVE_GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest'
];

// Compatibility cascade for text synthesis & summaries
const GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest'
];

let lastWorkingAudioModel = null;

// Hydrate cached model from chrome.storage.local on service worker startup
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(['last_working_audio_model'], (res) => {
    if (res && res.last_working_audio_model && ACTIVE_GEMINI_MODELS.includes(res.last_working_audio_model)) {
      lastWorkingAudioModel = res.last_working_audio_model;
      console.log(`[Gemini Background] Restored cached working model: ${lastWorkingAudioModel}`);
    }
  });
}

function setWorkingAudioModel(model) {
  if (!model || !ACTIVE_GEMINI_MODELS.includes(model)) return;
  lastWorkingAudioModel = model;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ last_working_audio_model: model });
  }
}

function getOrderedAudioModels() {
  if (lastWorkingAudioModel && ACTIVE_GEMINI_MODELS.includes(lastWorkingAudioModel)) {
    return [lastWorkingAudioModel, ...ACTIVE_GEMINI_MODELS.filter(m => m !== lastWorkingAudioModel)];
  }
  return [...ACTIVE_GEMINI_MODELS];
}

async function fetchWithBackoff(url, options, maxRetries = 1) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      const isTransient = response.status === 500 || 
                          response.status === 502 || 
                          response.status === 503 || 
                          response.status === 504 || 
                          response.status === 429;

      if (isTransient && attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 300);
        const delay = 800 + jitter; // Fast ~800-1100ms retry before cascading to next model
        console.warn(`[Gemini Background] HTTP ${response.status} (${response.statusText || 'Overloaded'}). Quick retry in ${delay}ms before model cascade...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return response;
    } catch (networkErr) {
      if (attempt < maxRetries) {
        const delay = 1000 * (attempt + 1);
        console.warn(`[Gemini Background] Network error (${networkErr.message}). Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw networkErr;
    }
  }
}

async function handleGeminiTranscription({ apiKey, base64Audio, mimeType, roomName, participants = [] }) {
  let activeKey = (apiKey || DEFAULT_GEMINI_KEY || '').trim();
  activeKey = activeKey.replace(/^["'`\s]+|["'`\s]+$/g, '');
  if (!activeKey) {
    throw new Error('Gemini API Key is missing. Please enter your free Gemini API key in Settings (⚙️).');
  }
  if (!base64Audio) {
    throw new Error('No audio data provided to transcribe.');
  }

  const rosterClause = (Array.isArray(participants) && participants.length > 0)
    ? `Meeting participants on this call: ${participants.join(', ')}. Attribute speech to each participant by name.`
    : `Tag each speaker's real name before their speech (or Speaker 1, Speaker 2 if names are unmentioned).`;

  const promptText = `You are an expert executive meeting transcriber and secretary. 
Listen carefully to this entire meeting audio recording (${roomName || 'Meeting'}).
${rosterClause}

Produce a structured markdown output with the following exact sections:

## 📝 Verbatim Spoken Transcript
Write the full transcript of what was spoken by all participants. EVERY line of speech MUST have the speaker's name tagged before their words (e.g. [00:05] Speaker Name: "...", [00:22] Other Speaker: "..."). Make sure all technical words, discussions, and decisions are accurately captured.

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
  const modelsToTry = getOrderedAudioModels();
  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(activeKey)}`;
      console.log(`[Gemini Background] Requesting transcription via ${model}...`);
      
      const response = await fetchWithBackoff(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let errMsg = `Model ${model} returned (${response.status})`;
        try {
          const rawText = await response.text();
          const errJson = JSON.parse(rawText);
          if (errJson?.error?.message) {
            errMsg = errJson.error.message;
          } else if (rawText) {
            errMsg = rawText;
          }
        } catch (e) {}

        if (response.status === 503) {
          errMsg = `Model ${model} overloaded (503). Cascading to next model...`;
        } else if (response.status === 429) {
          errMsg = `Model ${model} rate/quota limit reached (429). Cascading to next model...`;
        } else if (response.status === 400 && errMsg.toLowerCase().includes('api_key')) {
          errMsg = 'Invalid Gemini API key. Please check your key in Settings.';
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        throw new Error(`Empty response from model ${model}`);
      }

      console.log(`[Gemini Background] Successfully transcribed via ${model}`);
      setWorkingAudioModel(model);

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
async function handleGeminiChunkTranscription({ apiKey, base64Audio, mimeType, chunkIndex, totalChunks, startTime, endTime, roomName, participants = [] }) {
  let activeKey = (apiKey || DEFAULT_GEMINI_KEY || '').trim();
  activeKey = activeKey.replace(/^["'`\s]+|["'`\s]+$/g, '');
  if (!activeKey) {
    throw new Error('Gemini API Key is missing. Please enter your free Gemini API key in Settings (⚙️).');
  }
  if (!base64Audio) {
    return { chunkIndex, transcript: '' };
  }

  const rosterClause = (Array.isArray(participants) && participants.length > 0)
    ? `Known meeting participants: ${participants.join(', ')}. Attribute speech accurately to the speaker by their name.`
    : `Identify and tag the speaker's name before each line of speech.`;

  const promptText = `You are a high-accuracy meeting transcriber.
This is Audio Segment #${chunkIndex + 1} of ${totalChunks} (Time window: ${startTime || '00:00'} - ${endTime || '00:00'}) for meeting room "${roomName || 'Meeting'}".
${rosterClause}
Transcribe this entire audio segment verbatim. Every line of speech MUST have the speaker's name tagged before what was spoken (e.g. [${startTime || '00:00'}] Speaker Name: "...").
Return ONLY the timestamped speaker-tagged transcript text. Do not add conversational intro/outro.`;

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
  const modelsToTry = getOrderedAudioModels();
  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(activeKey)}`;
      const response = await fetchWithBackoff(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let errMsg = `Model ${model} returned (${response.status})`;
        try {
          const rawText = await response.text();
          const errJson = JSON.parse(rawText);
          if (errJson?.error?.message) {
            errMsg = errJson.error.message;
          } else if (rawText) {
            errMsg = rawText;
          }
        } catch (e) {}

        if (response.status === 400 && errMsg.toLowerCase().includes('api_key')) {
          throw new Error('Invalid Gemini API key. Please check your key in Settings.');
        } else if (response.status === 503) {
          errMsg = `Model ${model} overloaded (503). Cascading to next model...`;
        } else if (response.status === 429) {
          errMsg = `Model ${model} rate/quota limit reached (429). Cascading to next model...`;
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      const transcript = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      setWorkingAudioModel(model);
      return { chunkIndex, transcript: transcript.trim(), modelUsed: model };
    } catch (err) {
      if (err.message.includes('Invalid Gemini API key')) {
        throw err; // Fail fast on invalid key, do not waste time cycling models
      }
      lastError = err;
    }
  }

  throw lastError || new Error(`Failed to transcribe chunk #${chunkIndex}`);
}

/**
 * Validates Gemini API Key with a lightweight ping to Google Generative Language API
 */
async function handleGeminiTestKey({ apiKey }) {
  let activeKey = (apiKey || DEFAULT_GEMINI_KEY || '').trim();
  activeKey = activeKey.replace(/^["'`\s]+|["'`\s]+$/g, '');
  if (!activeKey) {
    throw new Error('Please enter a Gemini API key first.');
  }

  const testPayload = {
    contents: [{ parts: [{ text: 'Hello, respond with: OK' }] }]
  };

  // Test against active lifetime free tier models prioritized for speed and lowest 503 errors
  const testModels = [
    'gemini-3.1-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest'
  ];

  let lastErr = null;
  for (const model of testModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(activeKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload)
      });

      if (res.ok) {
        setWorkingAudioModel(model);
        return { success: true, modelUsed: model, message: `Connected! Verified with ${model}.` };
      }

      let errDetail = `HTTP ${res.status}`;
      let errReason = '';
      try {
        const txt = await res.text();
        const json = JSON.parse(txt);
        if (json?.error?.message) errDetail = json.error.message;
        if (json?.error?.details?.[0]?.reason) errReason = json.error.details[0].reason;
      } catch (e) {}

      if (res.status === 400) {
        if (errReason === 'API_KEY_INVALID' || errDetail.toLowerCase().includes('api key not valid') || errDetail.toLowerCase().includes('api_key')) {
          throw new Error('Invalid Gemini API Key. Google rejected this key. Please get a valid key from https://aistudio.google.com/app/apikey (keys start with "AIzaSy...").');
        }
        throw new Error(`Invalid request (${errDetail}). Please verify your Gemini API key in Settings.`);
      }

      if (res.status === 403) {
        if (errDetail.includes('API has not been used') || errDetail.includes('disabled')) {
          throw new Error('Generative Language API is disabled for this project. Please enable it in Google Cloud Console or create a new key in Google AI Studio.');
        }
        throw new Error(`Google API Permission Denied (403): ${errDetail}`);
      }

      if (res.status === 429) {
        throw new Error('Gemini quota / rate limit reached (429). Please check your Google AI Studio quota.');
      }

      lastErr = new Error(`${model}: ${errDetail}`);
    } catch (e) {
      if (e.message.includes('Invalid Gemini API Key') || e.message.includes('Permission Denied') || e.message.includes('quota / rate limit') || e.message.includes('Generative Language API is disabled')) {
        throw e;
      }
      lastErr = e;
    }
  }

  throw lastErr || new Error('Unable to connect to Gemini API. Check your connection or API key.');
}

/**
 * Synthesizes combined chunk transcripts into Executive Minutes
 */
async function handleGeminiSynthesizeSummary({ apiKey, fullTranscriptText, roomName, participants = [] }) {
  let activeKey = (apiKey || DEFAULT_GEMINI_KEY || '').trim();
  activeKey = activeKey.replace(/^["'`\s]+|["'`\s]+$/g, '');
  if (!activeKey) {
    throw new Error('No Gemini API key provided.');
  }

  const rosterClause = (Array.isArray(participants) && participants.length > 0)
    ? `Meeting participants: ${participants.join(', ')}.`
    : ``;

  const promptText = `You are an executive meeting secretary.
Below is the complete verbatim transcript with speaker tags from meeting "${roomName || 'Meeting'}".
${rosterClause}

Full Transcript:
${fullTranscriptText}

Based on this transcript, generate:
## 🎯 Key Decisions
- List every confirmed decision or consensus point, noting who decided/proposed it if known.

## ✅ Action Items & Owners
- [ ] List each actionable task with owner name and deadline if mentioned (e.g. - [ ] Task description (Owner)).

## 📌 Executive Summary
A crisp 3-sentence summary of the discussion.`;

  const payload = {
    contents: [{ parts: [{ text: promptText }] }]
  };

  let lastError = null;
  const modelsToTry = getOrderedAudioModels();
  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(activeKey)}`;
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
      setWorkingAudioModel(model);

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
