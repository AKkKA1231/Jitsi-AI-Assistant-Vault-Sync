/**
 * Automated Test Suite: Google Drive Real Upload Engine & Sync
 * Tests:
 * 1. Google Apps Script Webhook Dispatcher & Payload Validation
 * 2. Google Drive REST API v3 Multipart Payload Construction
 * 3. Unconfigured Credential Detection & Honest User Feedback
 * 4. Error Trapping (HTTP 401, Invalid Webhook, Network Timeouts)
 * 5. Multi-Account Quota Tracking & Hot-Swapping Integration
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('🧪 Starting Google Drive Upload Engine Automated Test Suite...\n');

// Mock localStorage for Node test environment
if (typeof localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function itAsync(desc, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// 1. Module Export & Structure Tests
// ---------------------------------------------------------------------------
console.log('--- Test Group 1: Google Drive Uploader Engine Contract ---');

await import('./extension/driveUploader.js');
const uploader = globalThis.JitsiDriveUploader;

it('Should export all required upload and utility methods', () => {
  assert.ok(uploader, 'JitsiDriveUploader must be attached to globalThis');
  assert.strictEqual(typeof uploader.uploadPackage, 'function', 'uploadPackage must be a function');
  assert.strictEqual(typeof uploader.uploadViaWebhook, 'function', 'uploadViaWebhook must be a function');
  assert.strictEqual(typeof uploader.uploadViaGoogleDriveApi, 'function', 'uploadViaGoogleDriveApi must be a function');
  assert.strictEqual(typeof uploader.blobToBase64, 'function', 'blobToBase64 must be a function');
});

// ---------------------------------------------------------------------------
// 2. Unconfigured Credentials & Truthful Feedback
// ---------------------------------------------------------------------------
console.log('\n--- Test Group 2: Unconfigured Credentials Safeguard ---');

await itAsync('Should decline upload and report honest unconfigured status when no credentials provided', async () => {
  const result = await uploader.uploadPackage({
    credentials: { webhookUrl: '', token: '' },
    folderName: 'meetingRecords',
    audioBlob: null,
    audioFileName: 'Meeting_Audio_Test.webm',
    markdownText: '# Meeting Notes',
    markdownFileName: 'Meeting_Summary_Test.md'
  });

  assert.strictEqual(result.success, false, 'Must not claim success without credentials');
  assert.strictEqual(result.isUnconfigured, true, 'isUnconfigured flag must be true');
  assert.ok(result.message.includes('Google Drive is not connected yet'), 'Must provide clear connection instructions');
});

// ---------------------------------------------------------------------------
// 3. Google Apps Script Webhook Protocol Test (Mocked Network)
// ---------------------------------------------------------------------------
console.log('\n--- Test Group 3: Google Apps Script Webhook Flow ---');

await itAsync('Should construct correct payload and process successful Webhook response', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedUrl = null;
  let interceptedBody = null;

  // Mock fetch for Google Apps Script Webhook
  globalThis.fetch = async (url, options) => {
    interceptedUrl = url;
    interceptedBody = JSON.parse(options.body);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        folderId: 'folder_abc_123',
        folderUrl: 'https://drive.google.com/drive/folders/folder_abc_123',
        audioUrl: 'https://drive.google.com/file/d/audio_xyz/view',
        notesUrl: 'https://drive.google.com/file/d/notes_xyz/view'
      })
    };
  };

  try {
    const fakeAudioBlob = new Blob(['FAKE_AUDIO_BYTES_TEST'], { type: 'audio/webm' });
    const progressLog = [];

    const result = await uploader.uploadPackage({
      credentials: { webhookUrl: 'https://script.google.com/macros/s/AKfycb_test/exec' },
      folderName: 'Engineering_Sync',
      audioBlob: fakeAudioBlob,
      audioFileName: 'Call_Audio_2026.webm',
      markdownText: '# Architecture Decisions\n- Adopted Webhook mode',
      markdownFileName: 'Call_Summary_2026.md',
      onProgress: (pct, msg) => progressLog.push({ pct, msg })
    });

    assert.strictEqual(result.success, true, 'Result must be success');
    assert.strictEqual(result.mode, 'webhook', 'Mode must be webhook');
    assert.strictEqual(result.folderId, 'folder_abc_123');
    assert.strictEqual(result.folderUrl, 'https://drive.google.com/drive/folders/folder_abc_123');
    assert.ok(result.audioUrl.includes('audio_xyz'));
    assert.ok(result.notesUrl.includes('notes_xyz'));

    // Verify progress callbacks
    assert.ok(progressLog.length >= 2, 'Must report progress milestones');
    assert.ok(progressLog.some(p => p.pct === 100), 'Must reach 100% progress');

    // Verify intercepted payload structure
    assert.strictEqual(interceptedUrl, 'https://script.google.com/macros/s/AKfycb_test/exec');
    assert.strictEqual(interceptedBody.folderName, 'Engineering_Sync');
    assert.strictEqual(interceptedBody.audioFileName, 'Call_Audio_2026.webm');
    assert.strictEqual(interceptedBody.markdownFileName, 'Call_Summary_2026.md');
    assert.ok(interceptedBody.markdownText.includes('Adopted Webhook mode'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await itAsync('Should support Instant Notes-Only sync mode (< 1s lightweight payload)', async () => {
  const originalFetch = globalThis.fetch;
  let sentPayload = null;
  globalThis.fetch = async (url, options) => {
    sentPayload = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        folderId: 'fast_folder_101',
        folderUrl: 'https://drive.google.com/drive/folders/fast_folder_101',
        notesUrl: 'https://drive.google.com/file/d/notes_101/view'
      })
    };
  };

  try {
    const result = await uploader.uploadViaWebhook({
      webhookUrl: 'https://script.google.com/macros/s/fast/exec',
      folderName: 'Quick_Sync',
      audioBlob: new Blob(['SOME_LARGE_AUDIO'], { type: 'audio/webm' }),
      audioFileName: 'audio.webm',
      markdownText: '# Instant Meeting Minutes\n- Fast note',
      markdownFileName: 'Meeting_Summary.md',
      syncMode: 'notes_only',
      onProgress: () => {}
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.folderId, 'fast_folder_101');
    assert.strictEqual(sentPayload.audioBase64, '', 'Must not transmit audio in notes_only mode');
    assert.ok(sentPayload.markdownText.includes('Instant Meeting Minutes'), 'Must transmit markdown notes');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await itAsync('Should accept alternative Apps Script success payloads (status: success, result: ok)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      status: 'success',
      folderId: 'alt_folder_888',
      folderUrl: 'https://drive.google.com/drive/folders/alt_folder_888'
    })
  });

  try {
    const result = await uploader.uploadViaWebhook({
      webhookUrl: 'https://script.google.com/macros/s/alt/exec',
      folderName: 'Alt_Sync',
      audioBlob: null,
      audioFileName: 'audio.webm',
      markdownText: 'notes',
      markdownFileName: 'notes.md',
      onProgress: () => {}
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.folderId, 'alt_folder_888');
    assert.strictEqual(result.folderUrl, 'https://drive.google.com/drive/folders/alt_folder_888');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await itAsync('Should surface specific error messages from Apps Script instead of generic fallback', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      status: 'error',
      message: 'Drive storage quota full for user account'
    })
  });

  try {
    await assert.rejects(
      async () => {
        await uploader.uploadViaWebhook({
          webhookUrl: 'https://script.google.com/macros/s/quota/exec',
          folderName: 'QuotaTest',
          audioBlob: null,
          audioFileName: 'audio.webm',
          markdownText: 'notes',
          markdownFileName: 'notes.md',
          onProgress: () => {}
        });
      },
      /Drive storage quota full for user account/,
      'Must surface specific error message from Apps Script'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await itAsync('Should gracefully catch and format Webhook HTTP errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    statusText: 'Bad Gateway'
  });

  try {
    await assert.rejects(
      async () => {
        await uploader.uploadViaWebhook({
          webhookUrl: 'https://script.google.com/macros/s/invalid/exec',
          folderName: 'Test',
          audioBlob: null,
          audioFileName: 'audio.webm',
          markdownText: 'notes',
          markdownFileName: 'notes.md',
          onProgress: () => {}
        });
      },
      /Google Apps Script returned HTTP 502/,
      'Must throw descriptive error on non-200 HTTP responses'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await itAsync('Should detect Google Apps Script "Authorization needed" HTML response and provide actionable guidance', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><head><title>Authorization needed</title><style>.auth-body {font-family: Roboto;}</style></head><body>Authorization required</body></html>'
  });

  try {
    await assert.rejects(
      async () => {
        await uploader.uploadViaWebhook({
          webhookUrl: 'https://script.google.com/macros/s/unauth/exec',
          folderName: 'AuthTest',
          audioBlob: null,
          audioFileName: 'audio.webm',
          markdownText: 'notes',
          markdownFileName: 'notes.md',
          onProgress: () => {}
        });
      },
      /Google Apps Script Permission Error: Web App is not authorized or "Who has access" is not set to "Anyone"/,
      'Must identify Authorization needed HTML and advise setting access to Anyone'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 4. Google Drive REST API v3 Multipart Protocol Test
// ---------------------------------------------------------------------------
console.log('\n--- Test Group 4: Google Drive REST API v3 Flow ---');

await itAsync('Should search folder, upload multipart markdown and audio via REST API v3', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });

    if (url.includes('drive/v3/files?q=')) {
      // Return folder found
      return {
        ok: true,
        status: 200,
        json: async () => ({
          files: [{ id: 'found_folder_999', name: 'meetingRecords', webViewLink: 'https://drive.google.com/drive/folders/found_folder_999' }]
        })
      };
    }

    if (url.includes('upload/drive/v3/files?uploadType=multipart')) {
      // Return uploaded file
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'uploaded_file_' + Math.floor(Math.random() * 1000),
          webViewLink: 'https://drive.google.com/file/d/test_uploaded/view'
        })
      };
    }

    return { ok: true, status: 200, json: async () => ({}) };
  };

  try {
    const fakeAudioBlob = new Blob(['AUDIO_BINARY_CHUNK_DATA'], { type: 'audio/webm' });
    const result = await uploader.uploadViaGoogleDriveApi({
      token: 'ya29.a0AfH6SMTestTokenValid',
      folderName: 'meetingRecords',
      audioBlob: fakeAudioBlob,
      audioFileName: 'Meeting_Audio_REST.webm',
      markdownText: '# Executive Minutes',
      markdownFileName: 'Meeting_Summary_REST.md',
      onProgress: () => {}
    });

    assert.strictEqual(result.success, true, 'REST API upload must succeed');
    assert.strictEqual(result.folderId, 'found_folder_999', 'Must attach to found folder ID');
    assert.ok(result.notesUrl, 'Must return markdown notes URL');
    assert.ok(result.audioUrl, 'Must return audio recording URL');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await itAsync('Should detect expired Google OAuth2 tokens (HTTP 401)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: { message: 'Invalid Credentials' } })
  });

  try {
    await assert.rejects(
      async () => {
        await uploader.uploadViaGoogleDriveApi({
          token: 'ya29.expired_token',
          folderName: 'meetingRecords',
          audioBlob: null,
          audioFileName: 'audio.webm',
          markdownText: 'notes',
          markdownFileName: 'notes.md',
          onProgress: () => {}
        });
      },
      /Google OAuth Token is invalid or expired/,
      'Must detect and report 401 expired token clearly'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 5. Multi-Account Storage Sync & Quota Rollover Test
// ---------------------------------------------------------------------------
console.log('\n--- Test Group 5: Google Drive Multi-Account Rollover ---');

const { GoogleDriveService } = await import('./src/services/googleDrive.js');
const driveService = new GoogleDriveService();

it('Should support hot-swapping between Account 1 and Account 2', () => {
  const accs = driveService.getAllAccounts();
  assert.ok(accs.length >= 2, 'Must have at least 2 accounts');

  driveService.setActiveAccount(accs[1].id);
  assert.strictEqual(driveService.getActiveAccount().id, accs[1].id);

  driveService.setActiveAccount(accs[0].id);
  assert.strictEqual(driveService.getActiveAccount().id, accs[0].id);
});

it('Should calculate free quota accurately before upload', () => {
  const stats = driveService.getAccountStorageStats();
  assert.ok(typeof stats.freeGb === 'number');
  assert.ok(stats.freeGb > 0, 'Must show available free space');
  assert.strictEqual(stats.isFull, false);
});

// ---------------------------------------------------------------------------
// 6. UI & Setup Documentation Verification
// ---------------------------------------------------------------------------
console.log('\n--- Test Group 6: UI & Documentation Integrity ---');

it('Should verify GOOGLE_DRIVE_SETUP_GUIDE.md exists and contains copy-paste Apps Script code', () => {
  const guidePath = path.resolve('./GOOGLE_DRIVE_SETUP_GUIDE.md');
  assert.ok(fs.existsSync(guidePath), 'GOOGLE_DRIVE_SETUP_GUIDE.md must exist in project root');
  const guideText = fs.readFileSync(guidePath, 'utf-8');

  assert.ok(guideText.includes('function doPost(e)'), 'Guide must contain doPost(e) Google Apps Script snippet');
  assert.ok(guideText.includes('DriveApp.getFoldersByName'), 'Guide must contain DriveApp folder creation logic');
  assert.ok(guideText.includes('New deployment') && guideText.includes('Web app'), 'Guide must explain deployment steps');
});

it('Should verify extension content.js contains Webhook and OAuth input handlers', () => {
  const contentJs = fs.readFileSync(path.resolve('./extension/content.js'), 'utf-8');
  assert.ok(contentJs.includes('jitsiAccWebhookInput'), 'content.js must have Webhook input selector');
  assert.ok(contentJs.includes('jitsiAccTokenInput'), 'content.js must have OAuth token input selector');
  assert.ok(contentJs.includes('uploadPackage'), 'content.js must call uploadPackage');
  assert.ok(contentJs.includes('Local Backup Saved'), 'content.js must display transparent message when unconfigured');
});

// ---------------------------------------------------------------------------
// 7. Native .docx Word Document & Resumable Direct Upload Pipeline
// ---------------------------------------------------------------------------
console.log('\n--- Test Group 7: Native .docx Word Document & Resumable Direct Upload ---');

it('Should export markdownToDocxBlob and generate valid OpenXML .docx file', () => {
  assert.strictEqual(typeof uploader.markdownToDocxBlob, 'function', 'markdownToDocxBlob must be exported');

  const testMd = `# Executive Meeting Minutes
## Key Decisions
- Adopted Resumable Upload pipeline for 70+ minute meetings
- Transcripts saved as native .docx Word Documents

## Action Items
- Akhtar to test Drive and Slack pipeline

[00:00] Speaker 1: "Meeting is officially underway."`;

  const docxData = uploader.markdownToDocxBlob(testMd, 'Test Meeting');
  assert.ok(docxData, 'Must produce docx data');

  const buf = Buffer.isBuffer(docxData) ? docxData : (docxData.buffer ? Buffer.from(docxData.buffer) : Buffer.from(docxData));
  assert.ok(buf.length > 500, 'Docx buffer must be non-empty');

  // Verify PKZIP magic bytes (0x04034b50)
  assert.strictEqual(buf[0], 0x50, 'PK header byte 1');
  assert.strictEqual(buf[1], 0x4b, 'PK header byte 2');
  assert.strictEqual(buf[2], 0x03, 'PK header byte 3');
  assert.strictEqual(buf[3], 0x04, 'PK header byte 4');

  // Verify internal OpenXML entries
  const str = buf.toString('utf-8');
  assert.ok(str.includes('[Content_Types].xml'), 'Must include [Content_Types].xml');
  assert.ok(str.includes('word/document.xml'), 'Must include word/document.xml');
  assert.ok(str.includes('_rels/.rels'), 'Must include _rels/.rels');
});

await itAsync('Should execute Resumable Direct Upload when Webhook returns resumableUploadUrl', async () => {
  const originalFetch = globalThis.fetch;
  let putUrl = null;
  let putMethod = null;
  let putBody = null;

  globalThis.fetch = async (url, options) => {
    if (url.includes('script.google.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          folderId: 'folder_resumable_999',
          folderUrl: 'https://drive.google.com/drive/folders/folder_resumable_999',
          docUrl: 'https://docs.google.com/document/d/doc_999/edit',
          docxUrl: 'https://drive.google.com/file/d/docx_999/view',
          resumableUploadUrl: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session_xyz_789'
        })
      };
    }

    if (url.includes('uploadType=resumable')) {
      putUrl = url;
      putMethod = options.method;
      putBody = options.body;

      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'audio_file_resumable_456',
          webViewLink: 'https://drive.google.com/file/d/audio_file_resumable_456/view'
        })
      };
    }

    return originalFetch(url, options);
  };

  try {
    const fake70MinBlob = new Blob(['BINARY_AUDIO_SIMULATING_70_MINUTES'], { type: 'audio/webm' });
    const progressLog = [];

    const result = await uploader.uploadPackage({
      credentials: { webhookUrl: 'https://script.google.com/macros/s/AKfycb_resumable/exec' },
      folderName: 'infotech_Meetings',
      audioBlob: fake70MinBlob,
      audioFileName: 'Meeting_Audio_70min.webm',
      markdownText: '# Standup\n- Resumable direct upload verified',
      markdownFileName: 'Meeting_Summary.docx',
      roomName: 'infotech_Meetings',
      onProgress: (pct, msg) => progressLog.push({ pct, msg })
    });

    assert.strictEqual(result.success, true, 'Result must be success');
    assert.strictEqual(result.folderId, 'folder_resumable_999');
    assert.strictEqual(result.folderUrl, 'https://drive.google.com/drive/folders/folder_resumable_999');
    assert.ok(result.docxUrl.includes('docx_999'), 'Must include direct .docx Word document URL');
    assert.ok(result.audioUrl.includes('audio_file_resumable_456'), 'Must include direct audio file URL');

    // Verify direct binary PUT happened to Google Drive API
    assert.ok(putUrl.includes('session_xyz_789'), 'Must PUT binary audio to resumable upload endpoint');
    assert.strictEqual(putMethod, 'PUT');
    assert.ok(putBody, 'Must send binary audio blob in PUT body');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log(`\n========================================`);
console.log(`Google Drive Test Results: ${passedTests}/${totalTests} passed`);
console.log(`========================================\n`);
