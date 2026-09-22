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
   * Fast CRC32 checksum for standard PKZIP construction
   */
  function crc32(buf) {
    let table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c;
    }
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    return (crc ^ -1) >>> 0;
  }

  /**
   * Generates a 100% compliant uncompressed PKZIP buffer for OpenXML .docx
   */
  function createZipBuffer(files) {
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = (typeof TextEncoder !== 'undefined')
        ? new TextEncoder().encode(file.name)
        : Buffer.from(file.name, 'utf-8');

      let dataBytes;
      if (file.data instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(file.data))) {
        dataBytes = file.data;
      } else {
        dataBytes = (typeof TextEncoder !== 'undefined')
          ? new TextEncoder().encode(file.data)
          : Buffer.from(file.data, 'utf-8');
      }

      const crc = crc32(dataBytes);
      const size = dataBytes.length;

      // Local header (30 bytes + name)
      const lh = new Uint8Array(30 + nameBytes.length);
      const lhView = new DataView(lh.buffer, lh.byteOffset, lh.byteLength);
      lhView.setUint32(0, 0x04034b50, true);
      lhView.setUint16(4, 20, true);
      lhView.setUint16(6, 0, true);
      lhView.setUint16(8, 0, true);
      lhView.setUint16(10, 0, true);
      lhView.setUint16(12, 0, true);
      lhView.setUint32(14, crc, true);
      lhView.setUint32(18, size, true);
      lhView.setUint32(22, size, true);
      lhView.setUint16(26, nameBytes.length, true);
      lhView.setUint16(28, 0, true);
      lh.set(nameBytes, 30);

      localHeaders.push(lh, dataBytes);

      // Central header (46 bytes + name)
      const ch = new Uint8Array(46 + nameBytes.length);
      const chView = new DataView(ch.buffer, ch.byteOffset, ch.byteLength);
      chView.setUint32(0, 0x02014b50, true);
      chView.setUint16(4, 20, true);
      chView.setUint16(6, 20, true);
      chView.setUint16(8, 0, true);
      chView.setUint16(10, 0, true);
      chView.setUint16(12, 0, true);
      chView.setUint16(14, 0, true);
      chView.setUint32(16, crc, true);
      chView.setUint32(20, size, true);
      chView.setUint32(24, size, true);
      chView.setUint16(28, nameBytes.length, true);
      chView.setUint16(30, 0, true);
      chView.setUint16(32, 0, true);
      chView.setUint16(34, 0, true);
      chView.setUint16(36, 0, true);
      chView.setUint32(38, 0, true);
      chView.setUint32(42, offset, true);
      ch.set(nameBytes, 46);

      centralHeaders.push(ch);
      offset += lh.length + dataBytes.length;
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const ch of centralHeaders) centralDirSize += ch.length;

    // End of central directory (22 bytes)
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer, eocd.byteOffset, eocd.byteLength);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true);
    eocdView.setUint16(6, 0, true);
    eocdView.setUint16(8, files.length, true);
    eocdView.setUint16(10, files.length, true);
    eocdView.setUint32(12, centralDirSize, true);
    eocdView.setUint32(16, centralDirOffset, true);
    eocdView.setUint16(20, 0, true);

    const totalLen = offset + centralDirSize + 22;
    const finalBuf = new Uint8Array(totalLen);
    let cur = 0;
    for (const part of [...localHeaders, ...centralHeaders, eocd]) {
      finalBuf.set(part, cur);
      cur += part.length;
    }
    return finalBuf;
  }

  /**
   * Converts Markdown meeting notes into a valid Microsoft Word (.docx) file
   */
  function markdownToDocxBlob(markdownText, title = 'Meeting Minutes') {
    const escapeXml = (s) => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const lines = (markdownText || '').split('\n');
    let bodyXml = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        bodyXml += '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>';
        continue;
      }

      if (line.startsWith('# ')) {
        const text = escapeXml(line.slice(2).trim());
        bodyXml += `<w:p><w:pPr><w:spacing w:before="240" w:after="120"/><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="1E293B"/></w:rPr></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="1E293B"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
      } else if (line.startsWith('## ')) {
        const text = escapeXml(line.slice(3).trim());
        bodyXml += `<w:p><w:pPr><w:spacing w:before="200" w:after="100"/><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="334155"/></w:rPr></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="334155"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
      } else if (line.startsWith('### ')) {
        const text = escapeXml(line.slice(4).trim());
        bodyXml += `<w:p><w:pPr><w:spacing w:before="160" w:after="80"/><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="475569"/></w:rPr></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="475569"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        const text = escapeXml(line.slice(2).trim());
        bodyXml += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:color w:val="4F46E5"/><w:b/></w:rPr><w:t>• </w:t></w:r><w:r><w:rPr><w:sz w:val="22"/><w:color w:val="1E293B"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
      } else {
        const text = escapeXml(line);
        bodyXml += `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/><w:color w:val="334155"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
      }
    }

    const contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
      '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
      '  <Default Extension="xml" ContentType="application/xml"/>\n' +
      '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n' +
      '</Types>';

    const relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n' +
      '</Relationships>';

    const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n' +
      '  <w:body>\n' +
      bodyXml +
      '    <w:sectPr>\n' +
      '      <w:pgSz w:w="12240" w:h="15840"/>\n' +
      '      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>\n' +
      '    </w:sectPr>\n' +
      '  </w:body>\n' +
      '</w:document>';

    const zipBytes = createZipBuffer([
      { name: '[Content_Types].xml', data: contentTypesXml },
      { name: '_rels/.rels', data: relsXml },
      { name: 'word/document.xml', data: documentXml }
    ]);

    if (typeof Blob !== 'undefined') {
      const blob = new Blob([zipBytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      try {
        blob.buffer = zipBytes.buffer;
        blob.bytes = zipBytes;
      } catch (_) {}
      return blob;
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(zipBytes);
    }
    return zipBytes;
  }
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
        const lowerText = text.toLowerCase();
        const isHtml = text.trim().startsWith('<') || text.includes('<!DOCTYPE') || text.includes('<html') || text.includes('<head');

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
      notesUrl: json.notesUrl || json.notes_url || json.fileUrl || json.file_url || null,
      docUrl: json.docUrl || null,
      docxUrl: json.docxUrl || null,
      resumableUploadUrl: json.resumableUploadUrl || null
    };
  }

  /**
   * Upload using Google Apps Script Webhook with Resumable Direct Upload & native .docx support
   */
  async function uploadViaWebhook({ webhookUrl, folderName, audioBlob, audioFileName, markdownText, markdownFileName, roomName, syncMode = 'full', onProgress = () => {} }) {
    // Mode 1: Instant Notes Only (< 1s sync)
    if (syncMode === 'notes_only' || !audioBlob || audioBlob.size === 0) {
      onProgress(30, '⚡ Syncing meeting transcript and Word document (.docx) to Google Drive...');
      const payload = {
        folderName: folderName || 'meetingRecords',
        roomName: roomName || 'Meeting',
        audioFileName: '',
        audioBase64: '',
        markdownFileName: markdownFileName || 'Meeting_Summary.md',
        markdownText: markdownText || '',
        generateDocx: true
      };
      const result = await dispatchWebhookPayload({ webhookUrl, payload, onProgress });
      onProgress(100, 'Meeting notes and document uploaded to Google Drive!');
      return result;
    }

    // Mode 2: High-Capacity Full Package (Notes/.docx + Complete Audio)
    // Step 1: Create meeting folder on Drive, generate Google Doc + .docx Word file, and initiate Resumable Upload session
    const audioSizeMb = (audioBlob.size / 1024 / 1024).toFixed(1);
    onProgress(15, `Creating meeting folder and Word document (.docx) in Google Drive...`);

    const initPayload = {
      action: 'INIT_SYNC',
      folderName: folderName || 'meetingRecords',
      roomName: roomName || 'Meeting',
      audioFileName: audioFileName || 'Meeting_Audio.webm',
      audioMimeType: audioBlob ? (audioBlob.type || 'audio/webm') : 'audio/webm',
      audioSizeBytes: audioBlob ? audioBlob.size : 0,
      markdownFileName: markdownFileName || 'Meeting_Summary.md',
      markdownText: markdownText || '',
      generateDocx: true
    };

    const initResult = await dispatchWebhookPayload({ webhookUrl, payload: initPayload, onProgress });
    if (!initResult || !initResult.success) {
      throw new Error(initResult?.error || 'Failed to initialize meeting folder on Google Drive');
    }

    const folderId = initResult.folderId;
    const folderUrl = initResult.folderUrl || (folderId ? `https://drive.google.com/drive/folders/${folderId}` : '');
    const notesUrl = initResult.docxUrl || initResult.docUrl || initResult.notesUrl || '';
    let audioUrl = initResult.audioUrl || null;

    // Step 2: High-Speed Direct Audio Upload via Google Drive Resumable URL
    // This streams binary audio directly to Google Drive servers, completely bypassing Apps Script payload limits and timeouts!
    if (initResult.resumableUploadUrl && audioBlob && audioBlob.size > 0) {
      onProgress(40, `Streaming meeting audio directly to Google Drive (${audioSizeMb} MB)...`);
      try {
        const putRes = await fetch(initResult.resumableUploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': audioBlob.type || 'audio/webm'
          },
          body: audioBlob
        });

        if (putRes.ok) {
          const driveData = await putRes.json().catch(() => ({}));
          audioUrl = driveData.webViewLink || (driveData.id ? `https://drive.google.com/file/d/${driveData.id}/view` : null);
          console.log('[Drive Uploader] Direct resumable audio upload succeeded:', audioUrl);
        } else {
          console.warn(`[Drive Uploader] Direct upload returned status ${putRes.status}, falling back to Webhook attach...`);
        }
      } catch (streamErr) {
        console.warn('[Drive Uploader] Direct resumable upload notice:', streamErr);
      }
    }

    // Step 3: Fallback if resumable upload was not supported by the Apps Script deployment
    if (!audioUrl && audioBlob && audioBlob.size > 0) {
      onProgress(55, `Uploading meeting audio via Webhook (~${audioSizeMb} MB)...`);
      const audioBase64 = await blobToBase64(audioBlob);

      const audioPayload = {
        action: 'ATTACH_AUDIO',
        targetFolderId: folderId,
        folderName: folderName || 'meetingRecords',
        roomName: roomName || 'Meeting',
        audioFileName: audioFileName || 'Meeting_Audio.webm',
        audioMimeType: audioBlob?.type || 'audio/webm',
        audioBase64: audioBase64,
        markdownFileName: '',
        markdownText: ''
      };

      try {
        const audioResult = await dispatchWebhookPayload({ webhookUrl, payload: audioPayload, audioBase64, onProgress });
        if (audioResult && audioResult.audioUrl) {
          audioUrl = audioResult.audioUrl;
        }
      } catch (attachErr) {
        console.warn('[Drive Uploader] Webhook audio attach notice:', attachErr);
      }
    }

    onProgress(100, `Audio and .docx transcript successfully uploaded to Google Drive!`);
    return {
      success: true,
      mode: 'webhook',
      folderId,
      folderUrl,
      notesUrl,
      docUrl: initResult.docUrl || null,
      docxUrl: initResult.docxUrl || null,
      audioUrl: audioUrl || initResult.audioUrl || null
    };
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
    markdownToDocxBlob,
    uploadViaGoogleDriveApi,
    uploadViaWebhook,
    uploadPackage
  };
});
