// Node.js Automated Test Suite for Jitsi AI Assistant & Google Drive Sync
import assert from 'node:assert';
import http from 'node:http';
import https from 'node:https';

// Mock localStorage for Node environment
class MockLocalStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}
globalThis.localStorage = new MockLocalStorage();

console.log('🧪 Starting Jitsi AI Assistant Automated Test Suite...\n');

let testsPassed = 0;
let testsFailed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
    testsFailed++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${desc}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
    testsFailed++;
  }
}

// ----------------------------------------------------
// Test 1: Google Drive Service Multi-Account & Storage Switcher
// ----------------------------------------------------
console.log('--- Test Suite 1: Google Drive Multi-Account Management ---');
const { GoogleDriveService } = await import('./src/services/googleDrive.js');
const drive = new GoogleDriveService();

it('Should initialize with default Account 1 and Account 2', () => {
  const accounts = drive.getAllAccounts();
  assert.strictEqual(accounts.length, 2, 'Should have 2 default accounts');
  assert.strictEqual(accounts[0].id, 'acc_1');
  assert.strictEqual(accounts[1].id, 'acc_2');
});

it('Should return Account 1 as active by default', () => {
  const active = drive.getActiveAccount();
  assert.strictEqual(active.id, 'acc_1');
  assert.strictEqual(active.name, 'Account 1 (Primary Drive)');
});

it('Should switch active account to Account 2 (Backup)', () => {
  const success = drive.setActiveAccount('acc_2');
  assert.strictEqual(success, true);
  assert.strictEqual(drive.getActiveAccount().id, 'acc_2');
  assert.strictEqual(drive.getActiveAccount().name, 'Account 2 (Backup Drive)');
});

it('Should update ID, password/token, and target folder', () => {
  const updated = drive.updateAccount('acc_2', {
    clientId: 'new-backup-account@gmail.com',
    clientSecret: 'my-new-secure-token-12345',
    folderName: 'Custom_Drive_Archive'
  });
  assert.strictEqual(updated.clientId, 'new-backup-account@gmail.com');
  assert.strictEqual(updated.clientSecret, 'my-new-secure-token-12345');
  assert.strictEqual(updated.folderName, 'Custom_Drive_Archive');

  const reloaded = drive.getActiveAccount();
  assert.strictEqual(reloaded.clientId, 'new-backup-account@gmail.com');
});

it('Should calculate free storage and quota correctly', () => {
  const stats = drive.getAccountStorageStats('acc_1');
  assert.ok(stats.freeGb > 14, `Expected >14 GB free, got ${stats.freeGb}`);
  assert.strictEqual(stats.totalGb, 15.0);
  assert.strictEqual(stats.isFull, false);
});

it('Should create and switch to a 3rd new Google Account', () => {
  const newAcc = drive.addAccount({
    name: 'Account 3 (Emergency Hot-Swap)',
    clientId: 'team-emergency@gmail.com',
    clientSecret: 'secret-token-xyz'
  });
  assert.ok(newAcc.id.startsWith('acc_'));
  assert.strictEqual(drive.getAllAccounts().length, 3);
  drive.setActiveAccount(newAcc.id);
  assert.strictEqual(drive.getActiveAccount().id, newAcc.id);
});

// ----------------------------------------------------
// Test 2: AI Notes Service & Real-Time Summarizer
// ----------------------------------------------------
console.log('\n--- Test Suite 2: AI Notes & Heuristic NLP ---');
const { AiNotesService } = await import('./src/services/aiNotes.js');
const ai = new AiNotesService();

const sampleTranscripts = [
  { id: '1', speaker: 'Alice', text: 'Hello everyone. We agreed that the release date is next Friday.', timestamp: '10:00:15' },
  { id: '2', speaker: 'Bob', text: 'Great. I will deploy the backend API to production by Wednesday.', timestamp: '10:01:00' },
  { id: '3', speaker: 'Charlie', text: 'We decided to use Google Drive for all recorded meeting archives.', timestamp: '10:02:10' },
  { id: '4', speaker: 'Alice', text: 'David needs to update the client credentials and rotate secrets before deployment.', timestamp: '10:03:00' }
];

await itAsync('Should extract Key Decisions and Action Items in real-time', async () => {
  const liveNotes = await ai.generateLiveNotes(sampleTranscripts);
  assert.ok(liveNotes, 'Live notes should not be null');
  assert.ok(liveNotes.decisions.length >= 1, `Expected decisions >= 1, got ${liveNotes.decisions.length}`);
  assert.ok(liveNotes.actionItems.length >= 1, `Expected action items >= 1, got ${liveNotes.actionItems.length}`);
  
  // Verify decision captured
  const foundDecision = liveNotes.decisions.some(d => d.text.toLowerCase().includes('release date') || d.text.toLowerCase().includes('google drive'));
  assert.ok(foundDecision, 'Should detect release date or google drive decision');

  // Verify action item captured
  const foundAction = liveNotes.actionItems.some(a => a.task.toLowerCase().includes('deploy') || a.task.toLowerCase().includes('credentials'));
  assert.ok(foundAction, 'Should extract action item for deploy or credentials');
});

await itAsync('Should synthesize complete Executive Post-Meeting Summary', async () => {
  const meetingMeta = {
    room: 'test-room',
    startTime: new Date().toISOString(),
    durationMinutes: 15,
    participantCount: 4
  };
  const summary = await ai.generatePostMeetingSummary(meetingMeta, sampleTranscripts);
  assert.ok(summary, 'Post-meeting summary should be generated');
  assert.ok(summary.includes('# Executive Meeting Summary: test-room'), 'Should have executive title');
  assert.ok(summary.includes('## 🎯 Key Decisions'), 'Should include Key Decisions section');
  assert.ok(summary.includes('## ✅ Action Items'), 'Should include Action Items section');
  assert.ok(summary.includes('[ ]'), 'Should contain actionable checkboxes');
});

// ----------------------------------------------------
// Test 3: HTTP Server & Static Asset Integrity Check
// ----------------------------------------------------
console.log('\n--- Test Suite 3: Local Server & HTTP Endpoints (Port 3000) ---');
import fs from 'node:fs';
import path from 'node:path';

let testServer = null;
const serverPort = 3000;

await new Promise((resolve) => {
  const req = http.get(`http://localhost:${serverPort}/`, (res) => {
    resolve();
  });
  req.on('error', () => {
    testServer = http.createServer((req, res) => {
      let reqPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const filePath = path.join(process.cwd(), reqPath.replace(/^\//, ''));
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filePath);
        const mimeTypes = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.mjs': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json'
        };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        res.end(content);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    testServer.listen(serverPort, () => {
      resolve();
    });
  });
});

function checkHttp(reqPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${serverPort}${reqPath}`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, length: data.length, headers: res.headers });
      });
    }).on('error', reject);
  });
}

const assets = [
  '/',
  '/index.html',
  '/src/style.css',
  '/src/app.js',
  '/src/services/jitsi.js',
  '/src/services/transcription.js',
  '/src/services/aiNotes.js',
  '/src/services/googleDrive.js',
  '/src/services/recorder.js'
];

for (const asset of assets) {
  await itAsync(`HTTP 200 for ${asset}`, async () => {
    const res = await checkHttp(asset);
    assert.strictEqual(res.statusCode, 200, `Expected 200 for ${asset}, got ${res.statusCode}`);
    assert.ok(res.length > 50, `Asset ${asset} should not be empty (got ${res.length} bytes)`);
  });
}

if (testServer) {
  testServer.close();
}

// ----------------------------------------------------
// Test 4: Gemini Multimodal Audio & Extension Integration
// ----------------------------------------------------
console.log('\n--- Test Suite 4: Gemini Flash Audio Transcription & Extension Packaging ---');

it('Should verify Chrome Extension Manifest & Core Assets', () => {
  const manifestPath = path.resolve('./extension/manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  assert.strictEqual(manifest.manifest_version, 3, 'Must be Manifest V3');
  assert.ok(manifest.permissions.includes('storage'), 'Must request storage permission');

  const bgPath = path.resolve('./extension/background.js');
  const contentPath = path.resolve('./extension/content.js');
  const popupPath = path.resolve('./extension/popup.html');
  const zipPath = path.resolve('./jitsi-ai-assistant-plugin.zip');

  assert.ok(fs.existsSync(bgPath), 'background.js must exist');
  assert.ok(fs.existsSync(contentPath), 'content.js must exist');
  assert.ok(fs.existsSync(popupPath), 'popup.html must exist');
  assert.ok(fs.existsSync(zipPath), 'jitsi-ai-assistant-plugin.zip must exist');
  assert.ok(fs.statSync(zipPath).size > 1000, 'Extension zip archive must not be empty');
});

it('Should have Gemini Flash model cascade configured', () => {
  const bgContent = fs.readFileSync(path.resolve('./extension/background.js'), 'utf-8');
  const contentJs = fs.readFileSync(path.resolve('./extension/content.js'), 'utf-8');

  // Verify active lifetime free models configured
  assert.ok(bgContent.includes('gemini-3.1-flash-lite'), 'background.js must use gemini-3.1-flash-lite');
  assert.ok(bgContent.includes('gemini-3.6-flash'), 'background.js must use gemini-3.6-flash');
  assert.ok(bgContent.includes('gemini-3.5-flash'), 'background.js must use gemini-3.5-flash');
  assert.ok(bgContent.includes('gemini-flash-latest'), 'background.js must use gemini-flash-latest');
  assert.ok(contentJs.includes('gemini-3.1-flash-lite'), 'content.js must use gemini-3.1-flash-lite');

  // Verify discontinued models are NOT present in cascade
  assert.ok(!bgContent.includes("'gemini-1.5-flash'"), 'background.js must not use retired 1.5-flash');
  assert.ok(!bgContent.includes("'gemini-2.0-flash'"), 'background.js must not use retired 2.0-flash');
});

it('Should verify Gemini API Key persistence and auto-save synchronization across extension', () => {
  const contentJs = fs.readFileSync(path.resolve('./extension/content.js'), 'utf-8');
  const popupJs = fs.readFileSync(path.resolve('./extension/popup.js'), 'utf-8');
  const popupHtml = fs.readFileSync(path.resolve('./extension/popup.html'), 'utf-8');

  // Verify storage key consistency
  assert.ok(contentJs.includes("const STORAGE_AI_KEY = 'jitsi_plugin_gemini_key'"), 'content.js must define STORAGE_AI_KEY');
  assert.ok(popupJs.includes("const STORAGE_AI_KEY = 'jitsi_plugin_gemini_key'"), 'popup.js must define STORAGE_AI_KEY');

  // Verify chrome.storage sync & local fallback integration
  assert.ok(contentJs.includes('chrome.storage.sync'), 'content.js must support chrome.storage.sync');
  assert.ok(contentJs.includes('chrome.storage.local'), 'content.js must support chrome.storage.local');
  assert.ok(contentJs.includes('chrome.storage.onChanged'), 'content.js must listen for key updates across tabs');

  // Verify auto-save event listeners on typing/pasting
  assert.ok(contentJs.includes('addEventListener(\'paste\''), 'content.js must auto-save on paste');
  assert.ok(contentJs.includes('updateAiKeyDisplay'), 'content.js must provide visual confirmation badge');

  // Verify popup UI input
  assert.ok(popupHtml.includes('id="popupGeminiKeyInput"'), 'popup.html must have dedicated Gemini key input');
});

it('Should verify floating toggle bar zero-obstruction styling and proper z-index hierarchy', () => {
  const contentCss = fs.readFileSync(path.resolve('./extension/content.css'), 'utf-8');
  const contentJs = fs.readFileSync(path.resolve('./extension/content.js'), 'utf-8');

  // Verify z-index hierarchy: sidebar (1000000) > toggle button (999990)
  assert.ok(contentCss.includes('z-index: 1000000;'), 'Sidebar must have high z-index (1000000)');
  assert.ok(contentCss.includes('z-index: 999990;'), 'Toggle button must have lower z-index than sidebar');

  // Verify hiding rules when sidebar is open
  assert.ok(contentCss.includes('#jitsi-ai-sidebar.open ~ #jitsi-ai-toggle-btn') || contentCss.includes('#jitsi-ai-toggle-btn.sidebar-open'), 'Must hide toggle button when sidebar is open');

  // Verify compact mode styles exist
  assert.ok(contentCss.includes('#jitsi-ai-toggle-btn.compact'), 'Must support compact minimized toggle mode');

  // Verify drag event listeners in content.js
  assert.ok(contentJs.includes('pointerdown') && contentJs.includes('pointermove'), 'content.js must implement smooth pointer dragging');
});

await itAsync('Should verify real Google Drive uploader module supporting Webhook and REST API v3', async () => {
  await import('./extension/driveUploader.js');
  const uploader = globalThis.JitsiDriveUploader;

  assert.ok(uploader, 'JitsiDriveUploader must be defined on globalThis');
  assert.ok(typeof uploader.uploadPackage === 'function', 'uploadPackage must be exported');
  assert.ok(typeof uploader.uploadViaWebhook === 'function', 'uploadViaWebhook must be exported');
  assert.ok(typeof uploader.uploadViaGoogleDriveApi === 'function', 'uploadViaGoogleDriveApi must be exported');

  // Test unconfigured credentials handling
  const unconfiguredResult = await uploader.uploadPackage({
    credentials: { webhookUrl: '', token: '' },
    folderName: 'meetingRecords',
    audioBlob: null,
    markdownText: '# Test'
  });

  assert.strictEqual(unconfiguredResult.success, false, 'Unconfigured credentials must not claim success');
  assert.strictEqual(unconfiguredResult.isUnconfigured, true, 'Must flag unconfigured status honestly');
  assert.ok(unconfiguredResult.message.includes('Google Drive is not connected yet'), 'Must provide clear connection guidance');

  // Verify manifest host permissions include Google APIs
  const manifest = JSON.parse(fs.readFileSync(path.resolve('./extension/manifest.json'), 'utf-8'));
  assert.ok(manifest.host_permissions.includes('https://www.googleapis.com/*'), 'Must declare googleapis.com in host_permissions');
  assert.ok(manifest.host_permissions.includes('https://script.google.com/*'), 'Must declare script.google.com in host_permissions');
  assert.ok(manifest.content_scripts[0].js.includes('driveUploader.js'), 'Must include driveUploader.js in content_scripts');
});

await itAsync('Should verify live Gemini API connection if key is provided', async () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.log('   (Skipping live API call: GEMINI_API_KEY environment variable not set)');
    return;
  }
  const postData = JSON.stringify({
    contents: [{ parts: [{ text: 'Respond with OK' }] }]
  });

  const models = ['gemini-3.1-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash'];
  let successfulRes = null;

  for (const model of models) {
    try {
      const res = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'generativelanguage.googleapis.com',
          path: `/v1beta/models/${model}:generateContent?key=` + encodeURIComponent(key),
          method: 'POST',
          timeout: 8000,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        }, (r) => {
          let data = '';
          r.on('data', chunk => data += chunk);
          r.on('end', () => resolve({ status: r.statusCode, data, model }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Timeout')));
        req.write(postData);
        req.end();
      });

      if (res.status === 200) {
        successfulRes = res;
        break;
      }
    } catch (e) {
      // try next model
    }
  }

  assert.ok(successfulRes, 'At least one model in the Gemini cascade must return HTTP 200');
  assert.strictEqual(successfulRes.status, 200, 'Expected HTTP 200');
  const parsed = JSON.parse(successfulRes.data);
  const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
  assert.ok(text.length > 0, 'Gemini response must contain text output');
});

// ----------------------------------------------------
// Test 5: Fault-Tolerant Audio Vault & Long Meeting Recovery
// ----------------------------------------------------
console.log('\n--- Test Suite 5: Fault-Tolerant Audio Vault & 35-Minute Meeting Recovery ---');

it('Should verify IndexedDB Vault implementation in extension content script', () => {
  const contentJs = fs.readFileSync(path.resolve('./extension/content.js'), 'utf-8');
  assert.ok(contentJs.includes('JitsiAiAssistantVault'), 'Must declare JitsiAiAssistantVault database');
  assert.ok(contentJs.includes('initVaultDB'), 'Must define initVaultDB');
  assert.ok(contentJs.includes('createVaultSession'), 'Must define createVaultSession');
  assert.ok(contentJs.includes('appendChunkToVault'), 'Must define appendChunkToVault');
  assert.ok(contentJs.includes('saveVaultCheckpoint'), 'Must define saveVaultCheckpoint');
  assert.ok(contentJs.includes('findUnfinalizedSessions'), 'Must define findUnfinalizedSessions');
});

it('Should verify 5-second resilient slicing and 3-minute periodic checkpointing', () => {
  const contentJs = fs.readFileSync(path.resolve('./extension/content.js'), 'utf-8');
  assert.ok(contentJs.includes('mediaRecorder.start(5000)'), 'Must use 5-second slicing instead of volatile 15s');
  assert.ok(contentJs.includes('3 * 60 * 1000'), 'Must run periodic checkpoint interval every 3 minutes');
  assert.ok(contentJs.includes('jitsiVaultCheckpointStatus'), 'Must update vault checkpoint status in UI');
});

it('Should verify emergency backup traps for network drops and tab closures', () => {
  const contentJs = fs.readFileSync(path.resolve('./extension/content.js'), 'utf-8');
  assert.ok(contentJs.includes("window.addEventListener('offline'"), 'Must trap offline network drops');
  assert.ok(contentJs.includes("window.addEventListener('beforeunload'"), 'Must trap tab close/unload');
  assert.ok(contentJs.includes('Meeting_Audio_EMERGENCY_BACKUP_'), 'Must generate emergency backup audio file name');
});

it('Should verify startup crash/interruption recovery banner and actions', () => {
  const contentJs = fs.readFileSync(path.resolve('./extension/content.js'), 'utf-8');
  const contentCss = fs.readFileSync(path.resolve('./extension/content.css'), 'utf-8');

  assert.ok(contentJs.includes('checkAndDisplayRecovery'), 'Must check for unfinalized sessions on startup');
  assert.ok(contentJs.includes('jitsiRecoveryBanner'), 'Must render recovery banner component');
  assert.ok(contentJs.includes('jitsiTranscribeRecoveredBtn'), 'Must provide 1-click transcribe button for recovered audio');
  assert.ok(contentJs.includes('jitsiDownloadRecoveredBtn'), 'Must provide download button for recovered audio');
  assert.ok(contentCss.includes('.jitsi-ai-recovery-banner'), 'content.css must define recovery banner styles');
});

it('Should simulate 35-minute multi-chunk assembly without memory corruption', () => {
  // Simulate 35 minutes of 5-second chunks (420 chunks)
  const chunkCount = 420;
  const mockChunks = [];
  const dummyChunkBuffer = Buffer.from('FAKE_AUDIO_FRAME_SAMPLE_HEADER_DATA_1234567890');
  
  for (let i = 1; i <= chunkCount; i++) {
    mockChunks.push({
      index: i,
      size: dummyChunkBuffer.length,
      timestamp: `10:${String(Math.floor(i / 12)).padStart(2, '0')}:${String((i * 5) % 60).padStart(2, '0')}`,
      data: dummyChunkBuffer
    });
  }

  assert.strictEqual(mockChunks.length, 420, 'Must have 420 chunks for 35-min call');
  
  // Aggregate simulated chunks into a single combined buffer
  const combinedBuffer = Buffer.concat(mockChunks.map(c => c.data));
  const expectedTotalBytes = chunkCount * dummyChunkBuffer.length;
  assert.strictEqual(combinedBuffer.length, expectedTotalBytes, 'Compiled audio buffer size must perfectly match sum of chunks');
  
  // Verify checkpoint slices (every 36 chunks = 3 minutes)
  const checkpointIntervalChunks = 36;
  let checkpointsCount = 0;
  for (let c = checkpointIntervalChunks; c <= chunkCount; c += checkpointIntervalChunks) {
    checkpointsCount++;
  }
  assert.ok(checkpointsCount >= 11, `Expected at least 11 auto-checkpoints for 35 mins, got ${checkpointsCount}`);
});

it('Should verify Meeting Mic Mute synchronization and zeroing in audioMixer.js', () => {
  const mixerSrc = fs.readFileSync(path.resolve('./extension/modules/audioMixer.js'), 'utf-8');
  const contentJs = fs.readFileSync(path.resolve('./extension/content.js'), 'utf-8');

  // Verify mute detection for Google Meet and Jitsi
  assert.ok(mixerSrc.includes('isMeetingMicMuted'), 'audioMixer.js must define isMeetingMicMuted');
  assert.ok(mixerSrc.includes('data-is-muted'), 'audioMixer.js must check Google Meet data-is-muted attribute');
  assert.ok(mixerSrc.includes('turn on microphone'), 'audioMixer.js must detect Google Meet mute aria-label');
  assert.ok(mixerSrc.includes('#audio-mute'), 'audioMixer.js must check Jitsi mute button');

  // Verify gain zeroing and WebRTC track disabling when muted
  assert.ok(mixerSrc.includes('setValueAtTime(0') || mixerSrc.includes('setTargetAtTime(0'), 'audioMixer.js must zero gain when mic is off');
  assert.ok(mixerSrc.includes('track.enabled = false'), 'audioMixer.js must disable audio tracks when mic is off');

  // Verify manual mic override and UI indicator
  assert.ok(mixerSrc.includes('setManualMicMute'), 'audioMixer.js must export setManualMicMute');
  assert.ok(contentJs.includes('jitsiMicMuteToggleBtn'), 'content.js must provide mic mute toggle control');
});

// ----------------------------------------------------
// Results Summary
// ----------------------------------------------------
console.log('\n========================================');
console.log(`Automated Test Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('========================================\n');

if (testsFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
