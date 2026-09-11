# ☁️ Google Drive Sync Setup Guide
**Jitsi AI Assistant Vault & Sync**

This guide explains how to connect your personal or work Google Drive account to the Jitsi AI Assistant extension so all call recordings (`.webm`) and meeting notes (`.md`) upload automatically to your Google Drive.

---

## 🚀 Option 1: Google Apps Script Webhook (Recommended & Zero-Setup)

> **Why this is best:**  
> Works with **any Google account** (personal `@gmail.com` or Google Workspace). Requires **zero Google Cloud Console projects, zero billing, and zero OAuth verification screens**.

### ⏱️ Setup in 60 Seconds:

1. Open your browser and go to: **[script.google.com](https://script.google.com/home/start)**
2. Click **New Project** (+).
3. Delete any default code in the editor, and paste the following script:

```javascript
/**
 * Jitsi AI Assistant - Personal Google Drive Sync Webhook
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var targetFolder = data.folderName || "Jitsi_Meetings";
    
    // 1. Locate or create meeting folder
    var folders = DriveApp.getFoldersByName(targetFolder);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(targetFolder);

    var audioUrl = null;
    var notesUrl = null;

    // 2. Save Audio Recording (.webm)
    if (data.audioBase64) {
      var audioBytes = Utilities.base64Decode(data.audioBase64);
      var audioBlob = Utilities.newBlob(audioBytes, data.audioMimeType || "audio/webm", data.audioFileName || "Meeting_Audio.webm");
      var audioFile = folder.createFile(audioBlob);
      audioUrl = audioFile.getUrl();
    }

    // 3. Save Meeting Notes & Action Items (.md)
    if (data.markdownText) {
      var mdFile = folder.createFile(data.markdownFileName || "Meeting_Summary.md", data.markdownText, MimeType.PLAIN_TEXT);
      notesUrl = mdFile.getUrl();
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      folderId: folder.getId(),
      folderUrl: folder.getUrl(),
      audioUrl: audioUrl,
      notesUrl: notesUrl
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
```

4. Click **Deploy** (top-right blue button) > **New deployment**.
5. Click the gear icon (⚙️) next to "Select type" and choose **Web app**.
6. Fill in the fields:
   * **Description**: `Jitsi AI Meeting Sync`
   * **Execute as**: `Me (your-email@gmail.com)`
   * **Who has access**: `Anyone` *(Note: Since only your extension knows this unique webhook URL, it acts as your personal private secret key)*.
7. Click **Deploy**, click **Authorize access**, and sign in with your Google account.
8. Copy the **Web App URL** (looks like: `https://script.google.com/macros/s/AKfycb.../exec`).

### 🔗 Connect to the Extension:
1. Join any Jitsi call or open the extension settings.
2. Click the **Settings (⚙️)** tab.
3. Paste the URL into the **Google Apps Script Webhook URL** field.
4. Click **💾 Save Account**. You will see: `✓ Connected via Google Apps Script Webhook`.

Now whenever you click **Upload to Drive**, files upload directly into your personal `Jitsi_Meetings` folder on Google Drive!

---

## 🔑 Option 2: Direct Google OAuth2 Access Token (REST API v3)

If your organization manages Google Cloud Platform (GCP) credentials:

1. Obtain a valid OAuth2 Access Token (`ya29...`) with the scope:
   ```text
   https://www.googleapis.com/auth/drive.file
   ```
2. In the extension sidebar, open **Settings (⚙️)**.
3. Paste your token into the **Google OAuth2 Access Token** field.
4. Click **💾 Save Account**.
5. The extension will automatically communicate directly with `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`.

---

## 🛡️ Zero-Loss Guarantee
* If cloud credentials are not entered yet, clicking **Upload to Drive** will safely download the `.webm` recording and `.md` notes to your local computer's **Downloads** folder.
* Your recording and transcript are never lost!
