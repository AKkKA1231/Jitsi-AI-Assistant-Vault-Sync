# ☁️ Google Drive Sync Setup Guide
**Meetings_AI Assistant Vault & Sync**

This guide explains how to connect your personal or work Google Drive account to the Meetings_AI Assistant extension so all call recordings (`.webm`) and meeting notes (`.md`) upload automatically to your Google Drive.

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
 * Meetings_AI Assistant - Personal Google Drive Sync Webhook
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var mainFolderName = data.folderName || "meetingRecords";
    
    var meetingFolder;
    if (data.targetFolderId) {
      try {
        meetingFolder = DriveApp.getFolderById(data.targetFolderId);
      } catch (fErr) {}
    }

    if (!meetingFolder) {
      // 1. Locate or create main meetings folder
      var folders = DriveApp.getFoldersByName(mainFolderName);
      var mainFolder = folders.hasNext() ? folders.next() : DriveApp.createFolder(mainFolderName);

      // 2. Create subfolder per meeting session
      var room = data.roomName || "Meeting";
      var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT", "yyyy-MM-dd_HH-mm");
      meetingFolder = mainFolder.createFolder(room + "_" + dateStr);

      // Ensure ONLY this meeting folder is viewable to attendees via link (keeps personal Drive private)
      try {
        meetingFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (shareErr) {}
    }

    // 3. Save Meeting Notes & Action Items (.md) if provided
    var notesUrl = null;
    if (data.markdownText) {
      var mdFile = meetingFolder.createFile(data.markdownFileName || data.fileName || "Meeting_Summary.md", data.markdownText, "text/markdown");
      notesUrl = mdFile.getUrl();
    }

    // 4. Save Audio Recording (.webm) if provided
    var audioUrl = null;
    var audioBase64 = data.audioBase64 || data.base64Audio;
    if (audioBase64 && audioBase64.length > 0) {
      try {
        var audioBytes = Utilities.base64Decode(audioBase64);
        var audioBlob = Utilities.newBlob(audioBytes, data.audioMimeType || "audio/webm", data.audioFileName || "Meeting_Audio.webm");
        var audioFile = meetingFolder.createFile(audioBlob);
        audioUrl = audioFile.getUrl();
      } catch (audioErr) {
        meetingFolder.createFile("Audio_Upload_Notice.txt", "Audio payload exceeded Google Apps Script memory limit. Please download audio locally from the extension drawer.\n\nNotice: " + audioErr.toString());
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      status: "success",
      folderId: meetingFolder.getId(),
      folderUrl: meetingFolder.getUrl(),
      notesUrl: notesUrl,
      audioUrl: audioUrl
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      status: "error",
      error: err.toString(),
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Health check endpoint: visit your Web App URL in any browser tab to verify it's working!
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "ok",
    message: "Google Drive Sync Webhook is live and ready!"
  })).setMimeType(ContentService.MimeType.JSON);
}
```

4. Click **Deploy** (top-right blue button) > **New deployment**.
5. Click the gear icon (⚙️) next to "Select type" and choose **Web app**.
6. Fill in the fields (**CRITICAL**):
   * **Description**: `Jitsi AI Meeting Sync`
   * **Execute as**: `Me (your-email@gmail.com)`
   * **Who has access**: `Anyone` *(IMPORTANT: Must be "Anyone", NOT "Only myself" or "Google Account". If set to "Only myself", Google blocks extension requests with HTTP 400/401)*.
7. Click **Deploy**, click **Authorize access**, and sign in with your Google account.
8. Copy the **Web App URL** (looks like: `https://script.google.com/macros/s/AKfycb.../exec`).

> 💡 **Quick Verification**: Paste your Web App URL into a new browser tab. You should see `{"status":"ok","message":"Google Drive Sync Webhook is live and ready!"}`. If you see that, your webhook is 100% working!

### 🔗 Connect to the Extension:
1. Join any Jitsi call or open the extension settings.
2. Click the **Settings (⚙️)** tab.
3. Paste the URL into the **Google Apps Script Webhook URL** field.
4. Click **💾 Save Account**. You will see: `✓ Connected via Google Apps Script Webhook`.

Now whenever you click **Transcribe Call** or **Upload to Drive**, files upload automatically directly into your personal `meetingRecords` folder on Google Drive!

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
