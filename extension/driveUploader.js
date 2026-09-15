/**
 * Jitsi AI Assistant - Real Google Drive Uploader Engine
 * Supports:
 * 1. Direct Google Drive REST API v3 (OAuth2 Bearer Token)
 * 2. Google Apps Script Webhook (Zero-GCP-setup instant cloud sync)
 * 3. Transparent fallback with local preservation
 */

(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = lib;
  }
  if (typeof root !== 'undefined') {
    root.JitsiDriveUploader = lib;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /**
   * Converts a Blob to a Base64 string (Browser & Node.js compatible)
   */
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
      if (typeof FileReader === 'undefined') {
        reject(new Error('FileReader is not available'));
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = (reader.result || '').split(',')[1] || '';
        resolve(base64data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Upload using Google Drive REST API v3 with Bearer token
   */
  async function uploadViaGoogleDriveApi({ token, folderName, audioBlob, audioFileName, markdownText, markdownFileName, onProgress }) {
    onProgress(15, `Authenticating with Google Drive API v3...`);

    // 1. Locate or create folder
    let folderId = null;
    let folderUrl = null;

    try {
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`)}&fields=files(id,name,webViewLink)`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      if (searchRes.status === 401) {
        throw new Error('Google OAuth Token is invalid or expired. Please refresh your token in Settings.');
      }

      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        folderId = searchData.files[0].id;
        folderUrl = searchData.files[0].webViewLink;
      }
    } catch (e) {
      if (e.message.includes('expired') || e.message.includes('invalid')) throw e;
    }

    if (!folderId) {
      onProgress(30, `Creating folder '${folderName}' in Google Drive...`);
      const createFolderRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,webViewLink', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder'
        })
      });

      if (!createFolderRes.ok) {
        const errJson = await createFolderRes.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `Failed to create folder (${createFolderRes.status})`);
      }

      const createdFolder = await createFolderRes.json();
      folderId = createdFolder.id;
      folderUrl = createdFolder.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;
    }

    // 2. Upload Markdown Summary
    onProgress(50, `Uploading meeting summary '${markdownFileName}'...`);
    let notesFileUrl = null;
    if (markdownText) {
      const boundary = '-------314159265358979323846';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelim = `\r\n--${boundary}--`;

      const metadata = {
        name: markdownFileName,
        mimeType: 'text/markdown',
        parents: [folderId]
      };

      const multipartBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: text/markdown\r\n\r\n' +
        markdownText +
        closeDelim;

      const mdRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
      });

      if (mdRes.ok) {
        const mdData = await mdRes.json();
        notesFileUrl = mdData.webViewLink;
      }
    }

    // 3. Upload Audio Recording (.webm)
    let audioFileUrl = null;
    if (audioBlob && audioBlob.size > 0) {
      onProgress(75, `Uploading meeting audio recording (${(audioBlob.size / 1024).toFixed(0)} KB)...`);

      // Multipart upload with binary audio blob
      const boundary = '-------314159265358979323846';
      const metadata = {
        name: audioFileName,
        mimeType: audioBlob.type || 'audio/webm',
        parents: [folderId]
      };

      const metaBlob = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${audioBlob.type || 'audio/webm'}\r\n\r\n`
      ], { type: 'text/plain' });

      const endBlob = new Blob([`\r\n--${boundary}--`], { type: 'text/plain' });
      const compositeBlob = new Blob([metaBlob, audioBlob, endBlob]);

      const audioRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: compositeBlob
      });

      if (audioRes.ok) {
        const audioData = await audioRes.json();
        audioFileUrl = audioData.webViewLink;
      }
    }

    onProgress(100, `Successfully uploaded to Google Drive!`);
    return {
      success: true,
      mode: 'rest_api',
      folderId,
      folderUrl: folderUrl || `https://drive.google.com/drive/folders/${folderId}`,
      audioUrl: audioFileUrl,
      notesUrl: notesFileUrl
    };
  }

  /**
   * Streams large audio payloads in 4MB slices over chrome.runtime.connect Port to bypass 64MB IPC limit
   */
  function streamUploadViaPort({ webhookUrl, payload, audioBase64, onProgress, sliceSize = 4 * 1024 * 1024 }) {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'DRIVE_STREAM_UPLOAD' });
      const totalSlices = Math.ceil(audioBase64.length / sliceSize) || 1;
      let currentSlice = 0;

      // 55-second safety timer so UI never hangs indefinitely
      const safetyTimer = setTimeout(() => {
        try { port.disconnect(); } catch (e) {}
        reject(new Error('Google Drive upload timed out after 55s. Local backup files have been preserved.'));
      }, 55000);

      port.onMessage.addListener((response) => {
        if (response.type === 'SUCCESS') {
          clearTimeout(safetyTimer);
          port.disconnect();
          resolve(response.data);
        } else if (response.type === 'ERROR') {
          clearTimeout(safetyTimer);
          port.disconnect();
          reject(new Error(response.error || 'Streaming upload failed'));
        } else if (response.type === 'ACK') {
          if (currentSlice < totalSlices) {
            const start = currentSlice * sliceSize;
            const end = Math.min(audioBase64.length, start + sliceSize);
            const slice = audioBase64.substring(start, end);
            const progressPct = 50 + Math.round((currentSlice / totalSlices) * 35);
            if (onProgress) onProgress(progressPct, `Streaming audio slice (${currentSlice + 1}/${totalSlices})...`);
            port.postMessage({ type: 'CHUNK', chunkIndex: currentSlice, data: slice });
            currentSlice++;
          } else {
            if (onProgress) onProgress(85, `Finalizing Google Drive sync...`);
            port.postMessage({ type: 'COMPLETE' });
          }
        }
      });

      // Send initial metadata without audio payload
      const headerPayload = { ...payload, audioBase64: '' };
      port.postMessage({
        type: 'START',
        metadata: { webhookUrl, payload: headerPayload },
        totalSlices
      });
    });
  }

  /**
   * Dispatches payload to Webhook via port streaming, standard sendMessage, or direct fetch
   */
  async function dispatchWebhookPayload({ webhookUrl, payload, audioBase64 = '', onProgress = () => {} }) {
    let json = null;
    let bgServiceWorkerUsed = false;
    const isLargeAudio = audioBase64 && audioBase64.length > 20 * 1024 * 1024;

    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.connect === 'function' && isLargeAudio) {
      try {
        onProgress(55, `Streaming large meeting audio (~${(audioBase64.length / 1024 / 1024).toFixed(1)} MB) to background worker...`);
        json = await streamUploadViaPort({ webhookUrl, payload, audioBase64, onProgress });
        bgServiceWorkerUsed = true;
      } catch (streamErr) {
        console.warn('[Drive Uploader] Port streaming notice, falling back to message:', streamErr);
      }
    }

    if (!json && typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
      try {
        json = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'DRIVE_UPLOAD_WEBHOOK',
            webhookUrl,
            payload
          }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.success) {
              resolve(response.data);
            } else if (response && response.error) {
              reject(new Error(response.error));
            } else {
              reject(new Error('Background worker returned empty response'));
            }
          });
        });
        bgServiceWorkerUsed = true;
      } catch (bgErr) {
        if (bgErr.message.includes('exceeded maximum allowed size of 64MiB') && typeof chrome.runtime.connect === 'function') {
          json = await streamUploadViaPort({ webhookUrl, payload, audioBase64, onProgress });
          bgServiceWorkerUsed = true;
        } else {
          const isConnectionError = bgErr.message.includes('Could not establish connection') ||
                                    bgErr.message.includes('Receiving end does not exist') ||
                                    bgErr.message.includes('Extension context invalidated');
          if (!isConnectionError) throw bgErr;
        }
      }
    }

    // Direct fetch fallback for test environments or non-extension contexts
    if (!json && !bgServiceWorkerUsed) {
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

      if (typeof res.json === 'function') {
        try {
          json = await res.json();
        } catch (e) {}
      }
      if (!json && typeof res.text === 'function') {
        const text = await res.text().catch(() => '');
        try {
          json = JSON.parse(text);
        } catch (parseErr) {
          if (text && (text.includes('drive.google.com') || text.toLowerCase().includes('success'))) {
            json = {
              success: true,
              folderUrl: text.includes('drive.google.com') ? text.trim() : ''
            };
          } else {
            throw new Error(`Invalid response from Apps Script: ${text ? text.slice(0, 150) : 'Empty response'}`);
          }
        }
      }

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

      if (!isSuccessful) {
        const detailedError =
          (json && typeof json.error === 'string' && json.error.trim()) ||
          (json && json.error && typeof json.error === 'object' && (json.error.message || JSON.stringify(json.error))) ||
          (json && typeof json.message === 'string' && json.message.trim()) ||
          (json && typeof json.details === 'string' && json.details.trim()) ||
          (json && typeof json.msg === 'string' && json.msg.trim()) ||
          (json && typeof json.err === 'string' && json.err.trim()) ||
          (json && json.status && json.status !== 'error' && json.status !== 'failed' ? `Status: ${json.status}` : null) ||
          (json ? `Apps Script sync returned unsuccessful result (${JSON.stringify(json)})` : 'Apps Script returned an empty response');
        throw new Error(detailedError);
      }
    }

    if (!json) {
      throw new Error('No response received from Google Apps Script sync.');
    }

    const folderId = json.folderId || json.folder_id || json.id || (payload && payload.targetFolderId) || '';
    const cleanFolderUrl = json.folderUrl || json.folder_url || json.url || (folderId ? `https://drive.google.com/drive/folders/${folderId}` : `https://drive.google.com/drive/search?q=${encodeURIComponent((payload && payload.folderName) || 'meetingRecords')}`);

    return {
      success: true,
      mode: 'webhook',
      folderId: folderId,
      folderUrl: cleanFolderUrl,
      audioUrl: json.audioUrl || json.audio_url || null,
      notesUrl: json.notesUrl || json.notes_url || json.fileUrl || json.file_url || null
    };
  }

  /**
   * Upload using Google Apps Script Webhook with 32kbps voice optimization and decoupled notes sync
   */
  async function uploadViaWebhook({ webhookUrl, folderName, audioBlob, audioFileName, markdownText, markdownFileName, roomName, syncMode = 'full', onProgress = () => {} }) {
    // Mode 1: Instant Notes Only (< 1s sync)
    if (syncMode === 'notes_only' || !audioBlob || audioBlob.size === 0) {
      onProgress(30, '⚡ Fast-syncing meeting notes to Google Drive (< 1s)...');
      const payload = {
        folderName: folderName || 'meetingRecords',
        roomName: roomName || 'Meeting',
        audioFileName: '',
        audioBase64: '',
        markdownFileName: markdownFileName || 'Meeting_Summary.md',
        markdownText: markdownText || ''
      };
      const result = await dispatchWebhookPayload({ webhookUrl, payload, onProgress });
      onProgress(100, 'Upload complete!');
      return result;
    }

    // Mode 2: Optimized Full Package (Notes + Audio)
    const audioSizeMb = (audioBlob.size / 1024 / 1024).toFixed(1);
    onProgress(15, `Encoding audio package (${audioSizeMb} MB, 32 kbps voice optimized)...`);
    const audioBase64 = await blobToBase64(audioBlob);

    // If audio is exceptionally large (> 15MB Base64, e.g. > 1 hour of speech), use decoupled 2-step sync:
    const isVeryLarge = audioBase64 && audioBase64.length > 15 * 1024 * 1024;
    if (isVeryLarge) {
      onProgress(25, `Step 1/2: Fast-syncing meeting notes to Google Drive...`);
      const notesPayload = {
        folderName: folderName || 'meetingRecords',
        roomName: roomName || 'Meeting',
        audioFileName: '',
        audioBase64: '',
        markdownFileName: markdownFileName || 'Meeting_Summary.md',
        markdownText: markdownText || ''
      };
      const notesResult = await dispatchWebhookPayload({ webhookUrl, payload: notesPayload, onProgress });

      // Step 2: Attach audio to created folder
      onProgress(50, `Step 2/2: Notes saved! Attaching meeting audio (~${audioSizeMb} MB)...`);
      try {
        const audioPayload = {
          targetFolderId: notesResult.folderId,
          folderName: folderName || 'meetingRecords',
          roomName: roomName || 'Meeting',
          audioFileName: audioFileName || 'Meeting_Audio.webm',
          audioMimeType: audioBlob?.type || 'audio/webm',
          audioBase64: audioBase64,
          markdownFileName: '',
          markdownText: ''
        };
        const audioResult = await dispatchWebhookPayload({ webhookUrl, payload: audioPayload, audioBase64, onProgress });
        onProgress(100, 'Upload complete!');
        return {
          ...notesResult,
          audioUrl: audioResult.audioUrl || null
        };
      } catch (audioErr) {
        console.warn('[Drive Uploader] Audio upload notice (notes safely preserved):', audioErr);
        onProgress(100, 'Notes saved to Drive! Audio preserved locally.');
        return {
          ...notesResult,
          audioUrl: null,
          warning: 'Audio was preserved locally to protect against cloud execution limits.'
        };
      }
    }

    // Standard fast sync (< 15MB Base64) in single clean payload
    onProgress(40, `Transmitting package to Google Drive (~${audioSizeMb} MB)...`);
    const payload = {
      folderName: folderName || 'meetingRecords',
      roomName: roomName || 'Meeting',
      audioFileName: audioFileName || 'Meeting_Audio.webm',
      audioMimeType: audioBlob?.type || 'audio/webm',
      audioBase64: audioBase64,
      markdownFileName: markdownFileName || 'Meeting_Summary.md',
      markdownText: markdownText || ''
    };
    const result = await dispatchWebhookPayload({ webhookUrl, payload, audioBase64, onProgress });
    onProgress(100, 'Upload complete!');
    return result;
  }

  /**
   * Unified meeting package dispatcher
   */
  async function uploadPackage({ credentials, folderName, audioBlob, audioFileName, markdownText, markdownFileName, roomName, syncMode = 'full', onProgress = () => {} }) {
    const creds = credentials || {};
    const webhookUrl = (creds.webhookUrl || '').trim();
    const token = (creds.token || creds.clientSecret || '').trim();

    // 1. If user configured Apps Script Webhook
    if (webhookUrl && webhookUrl.startsWith('http')) {
      return await uploadViaWebhook({
        webhookUrl,
        folderName,
        audioBlob,
        audioFileName,
        markdownText,
        markdownFileName,
        roomName,
        syncMode,
        onProgress
      });
    }

    // 2. If user configured OAuth Access Token
    if (token && (token.startsWith('ya29.') || token.length > 30)) {
      return await uploadViaGoogleDriveApi({
        token,
        folderName,
        audioBlob,
        audioFileName,
        markdownText,
        markdownFileName,
        onProgress
      });
    }

    // 3. No genuine Google Drive credentials configured
    return {
      success: false,
      isUnconfigured: true,
      message: 'Google Drive is not connected yet. Please configure your OAuth Access Token or Google Apps Script Webhook in Settings (⚙️).'
    };
  }

  return {
    blobToBase64,
    uploadViaGoogleDriveApi,
    uploadViaWebhook,
    uploadPackage
  };
});
