/**
 * Meeting Assistant Extension - Background Service Worker
 * Handles network requests to Gemini Multimodal Audio API to bypass page-level CSP
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GEMINI_TRANSCRIBE') {
    handleGeminiTranscription(request)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message || err.toString() }));
    return true; // Keep message channel open for async response
  }

  if (request.action === 'DRIVE_UPLOAD_WEBHOOK') {
    handleDriveWebhookUpload(request)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message || err.toString() }));
    return true; // Keep message channel open for async response
  }
});

async function handleDriveWebhookUpload({ webhookUrl, payload }) {
  console.log('[Background Service Worker] Dispatching Webhook upload to Google Apps Script...');
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8' // Avoid CORS preflight on GAS
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`Google Apps Script returned HTTP ${res.status}`);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (parseErr) {
    throw new Error(`Invalid JSON response from Apps Script: ${text.slice(0, 120)}`);
  }

  if (!json.success) {
    throw new Error(json.error || 'Apps Script returned unsuccessful status');
  }

  return json;
}

const DEFAULT_GEMINI_KEY = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || ''; // use your Gemini Flash API key
const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];

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
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`;
      console.log(`[Gemini Background] Requesting transcription via ${model}...`);
      
      const response = await fetch(url, {
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
