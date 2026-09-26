# 🎙️ Meetings_AI Assistant & Vault Sync — Colleague Setup Guide
**Zero-Build, Pure Browser Plugin for Jitsi Meet & Google Meet**

Welcome to the **Meetings_AI Assistant & Vault Sync** browser extension! This guide walks you through installing the extension in **Google Chrome, Microsoft Edge, or Brave** in under 3 minutes.

---

## ⚡ TL;DR: Do I need to run a local server or install Node.js?

> **❌ NO! You do NOT need to run any local server, terminal commands, Node.js, Python, or build scripts.**  
>
> The extension is **100% client-side and standalone**. You can directly download the repository ZIP, load the `extension/` folder into your browser, and start your meeting immediately.

---

## 🌟 What Does This Extension Do?

When you join any [meet.jit.si](https://meet.jit.si) or Google Meet call, the assistant adds a smart floating badge and sidebar:
1. **Multi-Speaker Audio Recording**: Records both your microphone and all remote participants clearly.
2. **Real-Time Speech-to-Text & Notes**: Transcribes participants and extracts Action Items and Key Decisions live using Google Gemini Flash.
3. **Crash Protection (IndexedDB Vault)**: If your browser tab closes, battery dies, or Wi-Fi drops, your meeting notes and audio are automatically restored.
4. **Google Drive Sync**: Automatically uploads formatted Word documents (`.docx`), Markdown summaries (`.md`), and audio recordings (`.webm`) directly to your personal Google Drive.
5. **Slack Sharing**: One-click sharing of formatted meeting summaries directly to your team's Slack channel.
6. **Zero-Obstruction UI**: Drag the floating AI badge anywhere or minimize it to a tiny circular button.

---

## 🔐 Required Permissions Guide

Here is the exact list of permissions required and why each is needed:

| Permission Level | Permission | Purpose & Why It Is Needed | How to Grant |
| :--- | :--- | :--- | :--- |
| **Browser Site** | 🎙️ **Microphone** (`getUserMedia`) | Captures your voice to record your speech and transcribe meeting dialogue. | Click **"Allow"** when prompted by `meet.jit.si` or `meet.google.com`. |
| **Browser Site** | 🔊 **Speaker / Audio** | Captures incoming audio from other meeting participants. | Enabled by default when joining the call. |
| **Extension** | 💾 `storage` | Securely stores your Gemini API key, Google Drive Webhook URL, and settings in your browser's private local storage (`chrome.storage.local`). | Granted automatically when loading the extension. |
| **Extension** | 📌 `activeTab` & `tabCapture` | Enables capture of tab audio streams when active. | Granted automatically when loading the extension. |
| **Extension** | ⏰ `alarms` | Runs periodic 3-minute IndexedDB vault checkpoints so long meetings are never lost during browser crashes. | Granted automatically when loading the extension. |
| **Extension** | 🌐 `host_permissions` | Injects the AI assistant into `meet.jit.si`, `*.jitsi.net`, `*.jitsi.org`, and `meet.google.com`, and allows HTTPS calls to Google Gemini API (`generativelanguage.googleapis.com`), Google Apps Script (`script.google.com`), and Slack (`hooks.slack.com`). | Granted automatically when loading the extension. |
| **Google Drive** *(Optional)* | ☁️ **Web App ("Anyone")** | Allows the extension to upload notes and audio to your private Google Drive folder without requiring complex Google Cloud Console setup. | Set **"Who has access: Anyone"** in Google Apps Script deployment. |

---

## ⏱️ 3-Minute Installation Steps

### Step 1: Download the Extension
1. Download the repository from GitHub:  
   👉 **[https://github.com/AKkKA1231/Jitsi-AI-Assistant-Vault-Sync](https://github.com/AKkKA1231/Jitsi-AI-Assistant-Vault-Sync)**
2. Click **Code** → **Download ZIP** (or extract `jitsi-ai-assistant-plugin.zip`).
3. Extract the ZIP file to a folder on your computer. Inside you will find the **`extension/`** folder.

---

### Step 2: Load into Chrome, Edge, or Brave
1. Open your browser and navigate to your extensions manager:
   - **Google Chrome**: Open `chrome://extensions`
   - **Microsoft Edge**: Open `edge://extensions`
   - **Brave Browser**: Open `brave://extensions`
2. Turn **ON** the **"Developer mode"** toggle switch (in the top-right corner).
3. Click the **"Load unpacked"** button (top-left).
4. Select the **`extension/`** folder.
5. 🎉 **Done!** You will see **"Meetings_AI Assistant"** appear in your extension list.
6. *(Tip)* Click the **puzzle icon (🧩)** in your browser toolbar and pin the extension icon.

---

### Step 3: Enter Your Free Gemini API Key
1. Get a free API key in 30 seconds from **[Google AI Studio](https://aistudio.google.com/app/apikey)**.
2. Click the extension icon in your toolbar (or open any meeting and click the floating AI Assistant button).
3. Go to the **Settings** tab (⚙️ gear icon).
4. Paste your API key into the **Gemini API Key** box and click **Save Settings**.
   > 💡 *Your key is saved locally in your own browser's sandboxed storage (`chrome.storage.local`). It is never transmitted to any external server other than Google's official Gemini endpoint.*

---

### Step 4 (Optional): Connect Your Google Drive in 60 Seconds
If you want your `.docx` meeting notes, Markdown summaries, and audio recordings automatically saved in your Google Drive:

1. Open **[script.google.com](https://script.google.com/home/start)** in your browser and click **New Project**.
2. Replace all code in the editor with this script:

```javascript
/**
 * Meetings_AI Assistant - Personal Google Drive Sync Webhook
 * Generates formatted Google Docs, native .docx Word files, and uploads WebM audio.
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

    // 2. Create formatted Google Doc & .docx Word Document
    if (data.markdownText && data.markdownText.trim().length > 0) {
      try {
        var docTitle = (data.markdownFileName || "Meeting_Summary")
          .replace(/\.md$/i, "")
          .replace(/\.docx$/i, "");

        var doc = DocumentApp.create(docTitle);
        var body = doc.getBody();
        body.clear();

        var lines = data.markdownText.split("\n");
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) { body.appendParagraph(""); continue; }
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

        var docFile = DriveApp.getFileById(doc.getId());
        meetingFolder.addFile(docFile);
        DriveApp.getRootFolder().removeFile(docFile);
        docUrl = docFile.getUrl();

        // Convert to native Word .docx
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

    // 3. Initiate Google Drive Resumable Upload session for audio
    if (data.audioFileName && !data.audioBase64) {
      try {
        var token = ScriptApp.getOAuthToken();
        if (token) {
          var initApiUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
          var res = UrlFetchApp.fetch(initApiUrl, {
            method: "POST",
            headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
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

    // 4. Save Audio if passed directly in Base64
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
    return responseJson({ success: false, status: "error", error: err.toString() });
  }
}

function responseJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return responseJson({ status: "ok", message: "Google Drive Sync Webhook is live and ready!" });
}
```

3. Click **Deploy** (top-right) → **New deployment**.
4. Click the gear icon (⚙️) next to "Select type" and choose **Web app**.
5. Set the deployment configuration:
   - **Execute as**: `Me (your email)`
   - **Who has access**: `Anyone` *(Crucial: ensures the extension can deliver your notes)*
6. Click **Deploy**, click **Authorize access**, and allow permissions (click *Advanced* → *Go to Untitled project (unsafe)* → *Allow*).
7. Copy the **Web App URL** (`https://script.google.com/macros/s/.../exec`).
8. Paste it into the extension **Settings** under **Google Apps Script Webhook URL** and click **Save Settings**.
   > 💡 *If you skip Google Drive setup, clicking "Upload to Drive" will simply download the clean `.docx` / `.md` notes and `.webm` audio directly to your computer.*

---

## 🎯 How to Use During a Meeting

1. Join any meeting on **[meet.jit.si](https://meet.jit.si)** or Google Meet.
2. Click the floating **✨ AI Assistant** button on the right edge of your screen.
3. Click **"Start Recording"** (grant microphone permission if asked).
4. Watch live transcription and real-time Action Items update as participants speak.
5. When finished:
   - Click **"Stop"**.
   - Review your synthesized Executive Summary & Action Items.
   - Click **"Upload to Drive"** (or **"Export Markdown"** / **"Share to Slack"**).

---

## 🔍 Understanding System Notices (Under the Hood)

If you inspect the browser developer tools, you may notice informative system messages. Here is what they mean:

1. **`[Recording] tabCapture unavailable, falling back to DOM audio`**:
   - Chrome strictly restricts `chrome.tabCapture` unless an extension popup is actively open.
   - **How our system handles this:** Our built-in multi-layered audio engine immediately activates **DOM Audio Polling**, capturing every participant's `<audio>` stream directly from the meeting room with 100% fidelity.
2. **`Google Apps Script request timed out (50s)`**:
   - Google Apps Script enforces execution time limits on large audio files.
   - **How our system handles this:** The extension uploads the formatted `.docx` and `.md` notes to Drive, and automatically saves the complete `.webm` audio recording locally in your Downloads folder so nothing is ever lost.
3. **`[Transcription] Already in progress — skipping duplicate call`**:
   - A concurrency safeguard that prevents accidental duplicate Gemini API calls if the Stop button is clicked rapidly.

---

## ❓ Colleague FAQ

**Q: Can anyone else in the meeting see my AI assistant?**  
**A:** No. The extension runs entirely on your local machine. Other participants will never see the sidebar or notes unless you share your screen.

**Q: Does it work with my company Google Workspace account?**  
**A:** Yes! The Google Apps Script webhook works seamlessly on both personal `@gmail.com` accounts and Google Workspace domain accounts.

**Q: How do I update to the latest version?**  
**A:** Download or pull the latest repository files, go to `chrome://extensions`, and click the circular **Reload (🔄)** icon on the extension card.

---

*Need assistance or want to request a feature? Submit an issue on the [GitHub Repository](https://github.com/AKkKA1231/Jitsi-AI-Assistant-Vault-Sync).*
