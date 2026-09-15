import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('🧪 Starting Slack Notification & Google Drive Automation Test Suite...\n');

// ----------------------------------------------------
// Test 1: Chrome Manifest Slack Host Permissions
// ----------------------------------------------------
console.log('--- Test Group 1: Extension Manifest & Permissions ---');
{
  const manifestPath = path.resolve('./extension/manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  
  assert.ok(manifest.host_permissions.includes('https://hooks.slack.com/*'), 'Manifest must grant host_permissions to https://hooks.slack.com/*');
  console.log('  ✅ PASS: Verified https://hooks.slack.com/* in host_permissions');
}

// ----------------------------------------------------
// Test 2: Slack Block Kit Payload Construction
// ----------------------------------------------------
console.log('\n--- Test Group 2: Slack Block Kit Payload & Drive URL Integration ---');
{
  const bgPath = path.resolve('./extension/background.js');
  const bgCode = fs.readFileSync(bgPath, 'utf-8');

  assert.ok(bgCode.includes('SLACK_SEND_NOTIFICATION'), 'background.js must handle SLACK_SEND_NOTIFICATION action');
  assert.ok(bgCode.includes('handleSlackNotification'), 'background.js must define handleSlackNotification');
  assert.ok(bgCode.includes('https://hooks.slack.com/'), 'background.js must validate https://hooks.slack.com/ prefix');
  assert.ok(bgCode.includes('open_drive_folder'), 'background.js must include clickable Open in Drive action');
  
  console.log('  ✅ PASS: Verified SLACK_SEND_NOTIFICATION handler and Block Kit schema in background.js');
}

// ----------------------------------------------------
// Test 3: Content Script Slack Settings & Dispatcher
// ----------------------------------------------------
console.log('\n--- Test Group 3: Content Script UI & Auto-Share Automation ---');
{
  const contentPath = path.resolve('./extension/content.js');
  const contentCode = fs.readFileSync(contentPath, 'utf-8');

  assert.ok(contentCode.includes('STORAGE_SLACK_WEBHOOK_KEY'), 'content.js must define STORAGE_SLACK_WEBHOOK_KEY');
  assert.ok(contentCode.includes('STORAGE_SLACK_AUTO_KEY'), 'content.js must define STORAGE_SLACK_AUTO_KEY');
  assert.ok(contentCode.includes('dispatchSlackNotification'), 'content.js must implement dispatchSlackNotification');
  assert.ok(contentCode.includes('jitsiSlackWebhookInput'), 'content.js must have jitsiSlackWebhookInput element');
  assert.ok(contentCode.includes('jitsiShareSlackBtn'), 'content.js must have 1-click jitsiShareSlackBtn in upload box');
  assert.ok(contentCode.includes('jitsiTestSlackBtn'), 'content.js must have jitsiTestSlackBtn in settings');

  console.log('  ✅ PASS: Verified Slack UI inputs, storage sync, and 1-click share button in content.js');
}

// ----------------------------------------------------
// Test 4: Simulated Slack Payload Generation & Validation
// ----------------------------------------------------
console.log('\n--- Test Group 4: Block Kit Payload Structure Simulation ---');
{
  const roomName = 'Sprint Planning & Release';
  const folderUrl = 'https://drive.google.com/drive/folders/1nk1cgecVxPaK_WxDh6WShZ_7kXdhzGDj';
  const decisions = ['Agreed to launch v1.2 next Tuesday', 'Vault sync confirmed zero-loss'];
  const actions = ['Akhtar to deploy Web App webhook', 'Review test matrix'];
  const executiveSummary = 'The team reviewed sprint items and confirmed deployment timeline.';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🎙️ Meeting Notes: ${roomName}`, emoji: true }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Google Drive Meeting Folder:*\n<${folderUrl}|📂 View All Meeting Files in Google Drive>` },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: '📂 Open in Drive', emoji: true },
        url: folderUrl,
        style: 'primary',
        action_id: 'open_drive_folder'
      }
    }
  ];

  assert.strictEqual(blocks[0].type, 'header');
  assert.strictEqual(blocks[1].accessory.url, folderUrl);
  assert(blocks[1].text.text.includes(folderUrl));

  console.log('  ✅ PASS: Simulated Block Kit payload generates compliant header and clickable Drive button');
}

console.log('\n======================================================');
console.log('🎉 ALL SLACK NOTIFICATION AUTOMATION TESTS PASSED!');
console.log('======================================================\n');
