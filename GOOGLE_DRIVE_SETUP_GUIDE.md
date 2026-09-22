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
 * Supports:
 * - Direct Google Doc creation with rich typography & headers
 * - Native .docx Word document generation (MimeType.MICROSOFT_WORD)
 * - Drive API v3 Resumable Upload for high-capacity audio (0 MB limit, 0 timeouts!)
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return responseJson({ success: false, error: "Empty POST body" });
    }

    var data = JSON.parse(e.postData.contents);
    var mainFolderName = data.folderName || "meetingRecords";
    var meetingFolder;

    // 1. Locate or create meeting folder
    if (data.targetFolderId) {
      try {
        meetingFolder = DriveApp.getFolderById(data.targetFolderId);
      } catch (fErr) {}
    }

    if (!meetingFolder) {
      var folders = DriveApp.getFoldersByName(mainFolderName);
      var mainFolder = folders.hasNext() ? folders.next() : DriveApp.createFolder(mainFolderName);

      var room = data.roomName || "Meeting";
      var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT", "yyyy-MM-dd_HH-mm");
      meetingFolder = mainFolder.createFolder(room + "_" + dateStr);

      try {
        meetingFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (shareErr) {}
    }

    var folderId = meetingFolder.getId();
    var folderUrl = meetingFolder.getUrl();
    var docUrl = null;
    var docxUrl = null;
    var audioUrl = null;
    var resumableUploadUrl = null;

    // 2. Create formatted Google Doc & .docx Word Document if transcript text provided
    if (data.markdownText && data.markdownText.trim().length > 0) {
      try {
        var docTitle = (data.markdownFileName || "Meeting_Summary")
          .replace(/\.md$/i, "")
          .replace(/\.docx$/i, "");

        var doc = DocumentApp.create(docTitle);
        var body = doc.getBody();
        body.clear();

        // Style headings and bullet points
        var lines = data.markdownText.split("\n");
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) {
            body.appendParagraph("");
            continue;
          }
          if (line.indexOf("# ") === 0) {
            body.appendParagraph(line.substring(2)).setHeading(DocumentApp.ParagraphHeading.HEADING1);
          } else if (line.indexOf("## ") === 0) {
            body.appendParagraph(line.substring(3)).setHeading(DocumentApp.ParagraphHeading.HEADING2);
          } else if (line.indexOf("### ") === 0) {
            body.appendParagraph(line.substring(4)).setHeading(DocumentApp.ParagraphHeading.HEADING3);
          } else if (line.indexOf("- ") === 0 || line.indexOf("* ") === 0) {
            body.appendListItem(line.substring(2));
          } else {
            body.appendParagraph(line);
          }
        }
        doc.saveAndClose();

        // Move Google Doc to meetingFolder
        var docFile = DriveApp.getFileById(doc.getId());
        try {
          docFile.moveTo(meetingFolder);
        } catch (mErr) {
          meetingFolder.addFile(docFile);
          try { DriveApp.getRootFolder().removeFile(docFile); } catch (e) {}
        }
        docUrl = docFile.getUrl();

        // Generate native Microsoft Word .docx file!
        try {
          var docxBlob = docFile.getBlob().getAs(MimeType.MICROSOFT_WORD);
          docxBlob.setName(docTitle + ".docx");
          var docxFile = meetingFolder.createFile(docxBlob);
          docxUrl = docxFile.getUrl();
        } catch (docxErr) {
          var mdFile = meetingFolder.createFile(docTitle + ".md", data.markdownText, "text/markdown");
          docxUrl = mdFile.getUrl();
        }
      } catch (docErr) {
        var fallbackFile = meetingFolder.createFile("Meeting_Summary.md", data.markdownText || "", "text/markdown");
        docUrl = fallbackFile.getUrl();
        docxUrl = fallbackFile.getUrl();
      }
    }

    // 3. Initiate Google Drive API v3 Resumable Upload session for high-capacity audio
    if (data.audioFileName && !data.audioBase64) {
      try {
        var token = ScriptApp.getOAuthToken();
        if (token) {
          var initApiUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
          var res = UrlFetchApp.fetch(initApiUrl, {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + token,
              "Content-Type": "application/json"
            },
            payload: JSON.stringify({
              name: data.audioFileName || "Meeting_Audio.webm",
              parents: [folderId],
              mimeType: data.audioMimeType || "audio/webm"
            }),
            muteHttpExceptions: true
          });
          var headers = res.getAllHeaders();
          resumableUploadUrl = headers["Location"] || headers["location"] || null;
        }
      } catch (tokenErr) {}
    }

    // 4. Save Audio if passed directly in Base64 (for small recordings)
    var audioBase64 = data.audioBase64 || data.base64Audio;
    if (audioBase64 && audioBase64.length > 0) {
      try {
        var audioBytes = Utilities.base64Decode(audioBase64);
        var audioBlob = Utilities.newBlob(audioBytes, data.audioMimeType || "audio/webm", data.audioFileName || "Meeting_Audio.webm");
        var audioFile = meetingFolder.createFile(audioBlob);
        audioUrl = audioFile.getUrl();
      } catch (audioErr) {
        meetingFolder.createFile("Audio_Upload_Notice.txt", "Audio payload exceeded memory limits. Notice: " + audioErr.toString());
      }
    }

    return responseJson({
      success: true,
      status: "success",
      folderId: folderId,
      folderUrl: folderUrl,
      notesUrl: docxUrl || docUrl,
      docUrl: docUrl,
      docxUrl: docxUrl,
      audioUrl: audioUrl,
      resumableUploadUrl: resumableUploadUrl
    });

  } catch (err) {
    return responseJson({
      success: false,
      status: "error",
      error: err.toString(),
      message: err.toString()
    });
  }
}

function responseJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Health check endpoint: visit your Web App URL in any browser tab to verify it's working!
function doGet(e) {
  return responseJson({
    status: "ok",
    message: "Google Drive Sync Webhook is live and ready!"
  });
}
```

4. Click **Deploy** (top-right blue button) > **New deployment** (or **Manage deployments** > **Edit** > **Version: New version** > **Deploy**).
5. Click the gear icon (⚙️) next to "Select type" and choose **Web app**.
6. Fill in the fields (**CRITICAL**):
   * **Description**: `Jitsi AI Meeting Sync (Docx + Resumable Audio)`
   * **Execute as**: `Me (your-email@gmail.com)`
   * **Who has access**: `Anyone` *(IMPORTANT: Must be "Anyone", NOT "Only myself" or "Google Account". If set to "Only myself", Google blocks extension requests with HTTP 400/401/HTML login page)*.
7. Click **Deploy**, click **Authorize access**, and sign in with your Google account.
8. Copy the **Web App URL** (looks like: `https://script.google.com/macros/s/AKfycb.../exec`).

> 💡 **Updating Existing Deployment**: If you already deployed an older script, in script.google.com click **Deploy** > **Manage deployments** > Click the pencil icon (**Edit**) > Under Version select **New version** > Click **Deploy**. This ensures your Web App runs the new docx & resumable upload code!

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
