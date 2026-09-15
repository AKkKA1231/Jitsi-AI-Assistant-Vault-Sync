import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const SCREENSHOT_DIR = path.resolve('./test_screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

console.log('🚀 Starting Playwright E2E Test Suite for Jitsi AI Assistant & Plugin...\n');

let passed = 0;
let failed = 0;

function report(testName, ok, extra = '') {
  if (ok) {
    console.log(`  ✅ [PASS] ${testName} ${extra}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${testName} ${extra}`);
    failed++;
  }
}

async function runE2ETests() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    permissions: ['microphone']
  });

  const page = await context.newPage();

  // Listen for console logs and errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`  [Browser Console Error] ${msg.text()}`);
    }
  });

  try {
    // ------------------------------------------------------------------------
    // Step 1: Navigate to Web Application
    // ------------------------------------------------------------------------
    console.log('--- Phase 1: Application Shell & UI Loading ---');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

    const title = await page.title();
    report('Page Title Loaded', title.includes('Meetings_AI Assistant') || title.includes('Jitsi AI Assistant'), `(Title: "${title}")`);

    const brandText = await page.locator('.brand-text h1').textContent();
    report('Brand Header', brandText.includes('Meetings_AI') || brandText.includes('Jitsi'), `(Found: "${brandText}")`);

    const driveChipText = await page.locator('#activeAccountLabel').textContent();
    report('Google Drive Status Chip', driveChipText.includes('Account 1'), `(Label: "${driveChipText}")`);

    const quotaBadge = await page.locator('#driveQuotaBadge').textContent();
    report('Google Drive Quota Badge', quotaBadge.includes('free'), `(Badge: "${quotaBadge}")`);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_initial_dashboard.png') });

    // ------------------------------------------------------------------------
    // Step 2: Test Sidebar Navigation & Tabs
    // ------------------------------------------------------------------------
    console.log('\n--- Phase 2: Sidebar Navigation & Tabs ---');
    
    // Switch to Live Speech Tab
    await page.click('button[data-tab="tab-transcript"]');
    const speechTabActive = await page.locator('#tab-transcript').evaluate(el => el.classList.contains('active'));
    report('Switch to Live Speech Tab', speechTabActive);

    // Switch to Uploads Tab
    await page.click('button[data-tab="tab-uploads"]');
    const uploadsTabActive = await page.locator('#tab-uploads').evaluate(el => el.classList.contains('active'));
    const folderPath = await page.locator('#targetFolderPath').textContent();
    report('Switch to Uploads Tab', uploadsTabActive && folderPath.includes('meetingRecords'), `(Target: "${folderPath}")`);

    // Switch back to AI Notes Tab
    await page.click('button[data-tab="tab-live-notes"]');
    const notesTabActive = await page.locator('#tab-live-notes').evaluate(el => el.classList.contains('active'));
    report('Switch back to AI Notes Tab', notesTabActive);

    // ------------------------------------------------------------------------
    // Step 3: Google Drive Multi-Account Switcher & Credentials Update
    // ------------------------------------------------------------------------
    console.log('\n--- Phase 3: Google Drive Multi-Account & Credential Settings ---');
    await page.click('#driveStatusBtn');
    await page.waitForSelector('#settingsModal:not(.hidden)', { timeout: 3000 });
    report('Settings Modal Opens', true);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_settings_modal.png') });

    // Verify accounts exist in list
    const accountButtons = await page.locator('#accountsTabsList .account-pill-tab').count();
    report('Account List Rendered', accountButtons >= 2, `(Found ${accountButtons} accounts)`);

    // Switch to Account 2
    await page.locator('#accountsTabsList .account-pill-tab:has-text("Account 2")').click();
    const activeLabelVal = await page.locator('#accountLabelInput').inputValue();
    report('Switch to Account 2', activeLabelVal.includes('Account 2'), `(Input: "${activeLabelVal}")`);

    // Update credentials
    await page.fill('#clientIdInput', 'updated-backup-drive@gmail.com');
    await page.click('#saveAccountBtn');

    // Verify toast
    await page.waitForSelector('#toastNotification:not(.hidden)', { timeout: 3000 });
    const toastText = await page.locator('#toastMessage').textContent();
    report('Account Update Toast Notification', toastText.includes('updated'), `(Toast: "${toastText}")`);

    // Verify Jitsi Server Instance setting
    const jitsiDomainVal = await page.locator('#jitsiDomainInput').inputValue();
    report('Jitsi Server Instance Setting Present', jitsiDomainVal === 'meet.jit.si', `(Domain: "${jitsiDomainVal}")`);

    // Close settings modal
    await page.click('#closeSettingsFooterBtn');
    await page.waitForSelector('#settingsModal', { state: 'hidden', timeout: 3000 });
    report('Settings Modal Closed', true);

    // ------------------------------------------------------------------------
    // Step 4: Speech-to-Text Simulation & Live AI Note Generation
    // ------------------------------------------------------------------------
    console.log('\n--- Phase 4: Real-time STT Simulation & Autonomous AI Notes ---');

    // Go to Live Speech tab
    await page.click('button[data-tab="tab-transcript"]');

    // Click Demo Speech simulation button
    await page.click('#simulateDemoSpeechBtn');

    // Wait for simulated items to be processed
    await page.waitForTimeout(1600);

    const transcriptItemsCount = await page.locator('#transcriptFeed .transcript-item').count();
    report('Simulated Speech Rendered in Feed', transcriptItemsCount >= 4, `(Found ${transcriptItemsCount} items)`);

    const transcriptCountBadge = await page.locator('#transcriptCount').textContent();
    report('Transcript Counter Updated', Number(transcriptCountBadge) >= 4, `(Badge: ${transcriptCountBadge})`);

    // Switch to AI Notes tab to verify AI extraction
    await page.click('button[data-tab="tab-live-notes"]');
    await page.waitForTimeout(600);

    // Verify Key Decisions extraction
    const decisionCards = await page.locator('#aiNotesContainer .note-section-card:has(.card-title.decision)').count();
    report('AI Extracted Key Decisions', decisionCards >= 1, `(Found ${decisionCards} decision cards)`);

    // Verify Action Items extraction with checkboxes
    const taskItems = await page.locator('#aiNotesContainer .action-checkbox-item').count();
    report('AI Extracted Action Items', taskItems >= 1, `(Found ${taskItems} tasks)`);

    // Test clicking a task checkbox
    if (taskItems > 0) {
      await page.locator('#aiNotesContainer .action-checkbox-item input[type="checkbox"]').first().click();
      report('Interactive Task Checkbox Toggled', true);
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_live_ai_notes.png') });

    // ------------------------------------------------------------------------
    // Step 5: Post-Meeting Summary & Google Drive Upload Flow
    // ------------------------------------------------------------------------
    console.log('\n--- Phase 5: Post-Meeting Summary & Google Drive Auto-Sync ---');
    await page.click('#exportDriveBtn');
    await page.waitForSelector('#postMeetingModal:not(.hidden)', { timeout: 3000 });
    report('Post-Meeting Modal Opened', true);

    const summaryHtml = await page.locator('#postSummaryPreview').innerHTML();
    report('Executive Summary Rendered', summaryHtml.includes('Key Decisions') && summaryHtml.includes('Action Items'));

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_post_meeting_modal.png') });

    // Click Confirm Drive Upload
    await page.click('#confirmDriveUploadBtn');
    
    // Wait for the simulated chunked upload to complete (takes ~2.5s)
    await page.waitForSelector('#uploadProgressText:has-text("Success")', { timeout: 8000 });
    const progressText = await page.locator('#uploadProgressText').textContent();
    report('Google Drive Upload Pipeline Executed', progressText.includes('Success'), `(Status: "${progressText.substring(0, 45)}...")`);

    // Close modal
    await page.click('#closePostModalBtn');
    await page.waitForSelector('#postMeetingModal', { state: 'hidden', timeout: 3000 });
    report('Post-Meeting Modal Closed', true);

    // ------------------------------------------------------------------------
    // Step 6: Test Extension Plugin Injection (for meet.jit.si & jitsi.org)
    // ------------------------------------------------------------------------
    console.log('\n--- Phase 6: Extension Plugin Injection Verification (jitsi.org / meet.jit.si) ---');
    
    // Create a mock page simulating a live Jitsi room
    const jitsiPage = await context.newPage();
    jitsiPage.on('pageerror', err => console.log('  [JITSI PAGE ERROR]:', err.message));
    jitsiPage.on('console', msg => console.log('  [JITSI CONSOLE]:', msg.type(), msg.text()));
    await jitsiPage.goto('http://localhost:3000/mock_jitsi.html', { waitUntil: 'networkidle' });

    // Inject extension CSS and JS
    const extCss = fs.readFileSync(path.resolve('./extension/content.css'), 'utf-8');
    const extJs = fs.readFileSync(path.resolve('./extension/content.js'), 'utf-8');

    await jitsiPage.addStyleTag({ content: extCss });
    await jitsiPage.addScriptTag({ content: extJs });

    // Listen for unexpected browser alert dialogs (must fail if alert() is called)
    let dialogTriggered = false;
    jitsiPage.on('dialog', async dialog => {
      dialogTriggered = true;
      console.log(`  [UNEXPECTED DIALOG]: ${dialog.message()}`);
      await dialog.dismiss();
    });

    // Check if floating plugin button was injected
    const pluginBtnVisible = await jitsiPage.locator('#jitsi-ai-toggle-btn').isVisible();
    report('Injected Plugin Floating Button Visible', pluginBtnVisible);

    // Click floating button to open extension sidebar
    await jitsiPage.click('#jitsi-ai-toggle-btn');
    const sidebarOpen = await jitsiPage.locator('#jitsi-ai-sidebar').evaluate(el => el.classList.contains('open'));
    report('Injected Plugin Sidebar Opens on Click', sidebarOpen);

    // Test Change Account Button (opens Settings Tab without any alert dialog)
    await jitsiPage.click('#jitsiSwitchAccBtn');
    const settingsTabVisible = await jitsiPage.locator('#jitsiSettingsTab').isVisible();
    report('Change Account Button Opens Settings Tab (No Alert)', settingsTabVisible && !dialogTriggered);

    // Test entering custom actual email ID
    await jitsiPage.fill('#jitsiEmailInput', 'my.real.email@company.com');
    await jitsiPage.fill('#jitsiNameInput', 'My Primary Work Drive');
    await jitsiPage.click('#jitsiSaveAccountBtn');

    // Verify in-sidebar toast appeared
    const pluginToastText = await jitsiPage.locator('.jitsi-ai-ext-toast').textContent();
    report('In-Sidebar Toast Notification on Save', pluginToastText.includes('my.real.email@company.com'), `(Toast: "${pluginToastText}")`);

    // Test Switching to Account 2
    await jitsiPage.click('#jitsiPill1');
    await jitsiPage.fill('#jitsiEmailInput', 'backup.rollover@company.com');
    await jitsiPage.click('#jitsiSaveAccountBtn');
    await jitsiPage.click('#jitsiMakeActiveBtn');

    const updatedHeaderTitle = await jitsiPage.locator('#jitsiDriveAccName').textContent();
    const updatedHeaderEmail = await jitsiPage.locator('#jitsiDriveEmailDisplay').textContent();
    report('Switched Active Drive Target to Account 2', updatedHeaderEmail.includes('backup.rollover@company.com'), `(Header: ${updatedHeaderTitle} ${updatedHeaderEmail})`);

    // Switch to Recording Tab
    await jitsiPage.click('button[data-tab="recording"]');
    const recordingTabVisible = await jitsiPage.locator('#jitsiRecordingTab').isVisible();
    report('Multi-Participant Recording & VAD Tab Accessible', recordingTabVisible);

    // Verify Speaker count badge
    const speakerBadgeText = await jitsiPage.locator('#jitsiSpeakerCountBadge').textContent();
    report('Audio Mixer Discovers Call Participants', speakerBadgeText.includes('You'), `(Badge: "${speakerBadgeText}")`);

    // Test Audio Recording Trigger
    await jitsiPage.click('#jitsiToggleRecordBtn');
    await jitsiPage.waitForTimeout(1000);
    const stopBtnText = await jitsiPage.locator('#jitsiToggleRecordBtn').textContent();
    report('Multi-Speaker Audio Recording Started', stopBtnText.includes('Stop'), `(Button: "${stopBtnText}")`);

    // Stop recording and trigger post-meeting transcription
    await jitsiPage.click('#jitsiToggleRecordBtn');
    await jitsiPage.waitForTimeout(1000);

    // Verify Notes Tab automatically generated minutes
    const notesTabVisible = await jitsiPage.locator('#jitsiNotesTab').isVisible();
    report('Post-Meeting Notes Generated After Recording', notesTabVisible);

    const decisionsCount = await jitsiPage.locator('#jitsiDecisionsBox div').count();
    const actionsCount = await jitsiPage.locator('#jitsiActionsBox .jitsi-ai-ext-task-item').count();
    report('Extracted Key Decisions & Action Checkboxes', decisionsCount >= 1 && actionsCount >= 1, `(Decisions: ${decisionsCount}, Tasks: ${actionsCount})`);

    // Test Upload to Drive Button
    await jitsiPage.click('#jitsiUploadBtn');
    await jitsiPage.waitForSelector('#jitsiUploadBox', { state: 'visible', timeout: 3000 });
    report('Upload Progress Box Appears in Sidebar', true);

    // Wait for progress to finish
    await jitsiPage.waitForSelector('#jitsiUploadActions', { state: 'visible', timeout: 6000 });
    const driveLink = await jitsiPage.locator('#jitsiOpenDriveLink').getAttribute('href');
    report('Google Drive Link & Audio/Notes Download Buttons Rendered', driveLink.includes('drive.google.com') && !dialogTriggered, `(Drive URL: "${driveLink}")`);

    await jitsiPage.screenshot({ path: path.join(SCREENSHOT_DIR, '05_injected_jitsi_plugin.png') });
    await jitsiPage.close();

  } catch (err) {
    console.error('Fatal E2E test error:', err);
    failed++;
  } finally {
    await browser.close();
  }

  console.log('\n======================================================');
  console.log(`🏁 Playwright E2E Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log(`📸 Screenshots saved to: ${SCREENSHOT_DIR}`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runE2ETests();
