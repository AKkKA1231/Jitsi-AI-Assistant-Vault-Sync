import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const VIDEO_DIR = path.resolve('./demo_video');
if (!fs.existsSync(VIDEO_DIR)) {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
}

async function recordDemo() {
  console.log('🎥 Recording 45-second Manager Demo Video...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: 1366, height: 768 }
    }
  });

  const page = await context.newPage();

  try {
    // 1. Open app
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // 2. Highlight Google Drive Quota Switcher
    await page.click('#driveStatusBtn');
    await page.waitForTimeout(2000);

    // Switch to Account 2
    await page.locator('#accountsTabsList .account-pill-tab:has-text("Account 2")').click();
    await page.waitForTimeout(2000);

    // Show changing client ID
    await page.fill('#clientIdInput', 'manager-team-backup@gmail.com');
    await page.waitForTimeout(1000);
    await page.click('#saveAccountBtn');
    await page.waitForTimeout(2000);

    // Close settings
    await page.click('#closeSettingsFooterBtn');
    await page.waitForTimeout(1500);

    // 3. Go to Live Speech tab
    await page.click('button[data-tab="tab-transcript"]');
    await page.waitForTimeout(1500);

    // Trigger Demo Discussion
    await page.click('#simulateDemoSpeechBtn');
    await page.waitForTimeout(3000);

    // 4. Switch to AI Notes tab to show real-time extraction
    await page.click('button[data-tab="tab-live-notes"]');
    await page.waitForTimeout(2500);

    // Interact with action items
    const checkbox = page.locator('#aiNotesContainer .action-checkbox-item input[type="checkbox"]').first();
    if (await checkbox.count() > 0) {
      await checkbox.click();
      await page.waitForTimeout(1500);
    }

    // 5. Open Post-Meeting Summary & Upload Modal
    await page.click('#exportDriveBtn');
    await page.waitForTimeout(2500);

    // Click Upload to Drive
    await page.click('#confirmDriveUploadBtn');
    await page.waitForTimeout(3500);

    // Close modal
    await page.click('#closePostModalBtn');
    await page.waitForTimeout(2000);

    console.log('✅ Demo sequence recorded successfully!');
  } catch (err) {
    console.error('Error during video recording:', err);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  // Find the generated video file and rename it
  const files = fs.readdirSync(VIDEO_DIR).filter(f => f.endsWith('.webm'));
  if (files.length > 0) {
    const latestFile = files[files.length - 1];
    const finalPath = path.join(VIDEO_DIR, 'manager_demo.webm');
    fs.renameSync(path.join(VIDEO_DIR, latestFile), finalPath);
    console.log(`🎬 Video saved at: ${finalPath}`);
  }
}

recordDemo();
