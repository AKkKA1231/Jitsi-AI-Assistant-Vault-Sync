# 🎙️ Meetings_AI Assistant & Drive Sync — Colleague Setup Guide

Welcome to the **Meetings_AI Assistant & Vault Sync** browser plugin! This guide will help you install and run the extension in **Chrome, Edge, or Brave** in less than 3 minutes.

---

## 🌟 What Does This Plugin Do?

When you join any [meet.jit.si](https://meet.jit.si) meeting, this extension automatically adds a smart AI assistant to your screen:
1. **Live Speech-to-Text**: Transcribes speaking participants in real time.
2. **AI Action Items & Summaries**: Uses Google Gemini Flash to extract tasks, decisions, and meeting minutes live.
3. **Crash Protection (IndexedDB Vault)**: If your browser tab crashes or your laptop battery dies, your notes and audio are automatically restored.
4. **Google Drive Sync**: Automatically creates a meeting folder in your Google Drive and saves the Markdown notes + audio file directly.
5. **Zero-Obstruction UI**: You can drag the floating AI badge anywhere on your screen or minimize it to a tiny circular button.

---

## ⚡ 3-Minute Quick Start

### Step 1: Unzip / Extract the Extension Archive
1. If you received **`jitsi-ai-assistant-plugin.zip`**:
   - Right-click the `.zip` file and select **"Extract All..."** (or unzip it to a folder on your computer, e.g., `C:\jitsi-plugin`).
   - Open the extracted folder. You should see `manifest.json`, `background.js`, `content.js`, and `modules/` directly inside.
   > ⚠️ **Important:** Do *not* try to drag-and-drop the `.zip` file directly into Chrome. Chrome requires you to select the *unzipped* folder!

2. If you are cloning from GitHub:
   ```bash
   git clone https://github.com/AKkKA1231/Jitsi-AI-Assistant-Vault-Sync.git
   ```
   Select the `extension/` directory inside the repository.

---

### Step 2: Load the Unpacked Extension in Chrome / Edge / Brave
1. Open your browser and navigate to:
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
   - **Brave**: `brave://extensions`
2. Turn **ON** the **"Developer mode"** toggle (top right corner).
3. Click the **"Load unpacked"** button (top left corner).
4. Select the extracted folder containing `manifest.json`.
5. 🎉 **Done!** You will immediately see **"Meetings_AI Assistant & Drive Sync"** loaded with an active green status.

> ⚠️ **CRITICAL BROWSER REFRESH STEP:**  
> If you already had a Jitsi meeting tab (`https://meet.jit.si/...`) open before loading or reloading the extension, you **MUST refresh the meeting tab (`F5` or `Ctrl+R`)**! Browsers cannot inject newly installed or reloaded extensions into tabs opened prior to installation.

---

### Step 3: Enter & Test Your Lifetime Free Gemini API Key
The assistant uses Google's high-speed, lifetime free tier multimodal Gemini models (`gemini-3.1-flash-lite`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-flash-latest`):

1. Get a 100% lifetime free API key in 30 seconds from [Google AI Studio](https://aistudio.google.com/app/apikey) (no credit card required).
2. Click the extension icon in your browser toolbar to open the quick popup.
3. Paste your key in the **Gemini API Key** box and click **Test**.
4. You will see: `✅ Connected: gemini-3.1-flash-lite (Free Tier)`.
5. Click **Save**. Your key is saved locally in `chrome.storage.local` across all your calls.

---

### Step 4 (Optional): Connect Your Google Drive
If you want meeting notes and audio recordings automatically uploaded to your Google Drive:

1. Open [script.new](https://script.new) in your browser.
2. Replace all existing code with this Google Apps Script:
   ```javascript
   function doPost(e) {
     try {
       var data = JSON.parse(e.postData.contents);
       var subFolder;
       if (data.targetFolderId) {
         try {
           subFolder = DriveApp.getFolderById(data.targetFolderId);
         } catch (fErr) {}
       }
       
       if (!subFolder) {
          var mainFolder = DriveApp.getFoldersByName(data.folderName || "meetingRecords");
          var parentFolder = mainFolder.hasNext() ? mainFolder.next() : DriveApp.createFolder(data.folderName || "meetingRecords");
         var room = data.roomName || "Meeting";
         var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT", "yyyy-MM-dd_HH-mm");
          subFolder = parentFolder.createFolder(room + "_" + dateStr);
          try {
            subFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          } catch (shareErr) {}
        }
       
       // 1. Save Meeting Summary & Action Items (.md) if provided
       var mdUrl = null;
       if (data.markdownText) {
         var mdText = data.markdownText || data.fileContent || "# Meeting Summary\n\nAudio attached.";
         var mdFile = subFolder.createFile(data.markdownFileName || data.fileName || "Meeting_Summary.md", mdText, "text/markdown");
         mdUrl = mdFile.getUrl();
       }
       
       // 2. Save Audio Recording (.webm) if provided
       var audioUrl = null;
       var audioBase64 = data.audioBase64 || data.base64Audio;
       if (audioBase64 && audioBase64.length > 0) {
         try {
           var audioBytes = Utilities.base64Decode(audioBase64);
           var audioBlob = Utilities.newBlob(audioBytes, data.audioMimeType || "audio/webm", data.audioFileName || "Meeting_Audio.webm");
           var audioFile = subFolder.createFile(audioBlob);
           audioUrl = audioFile.getUrl();
         } catch (audioErr) {
           subFolder.createFile("Audio_Upload_Notice.txt", "Audio payload exceeded Google Apps Script memory limit. Please download audio locally from the extension drawer.\n\nNotice: " + audioErr.toString());
         }
       }
       
       return ContentService.createTextOutput(JSON.stringify({
         success: true,
         status: "success",
         folderId: subFolder.getId(),
         folderUrl: subFolder.getUrl(),
         notesUrl: mdUrl,
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
   ```
3. Click **Deploy** → **New deployment** → Select type: **Web app**.
   - **Execute as**: *Me*
   - **Who has access**: *Anyone*
4. Click **Deploy** (If Google shows *"Google hasn't verified this app"*, click **Advanced** → **Go to Untitled project (unsafe)** → **Allow**).
5. Copy the resulting **Web App URL** (`https://script.google.com/macros/s/.../exec`).
6. Paste it into the plugin's **Settings** tab under **Google Apps Script Webhook URL** and click **Save Settings**.
   > 💡 *If you skip this step, clicking "Upload to Drive" will simply download the clean Markdown summary and recording directly to your computer!*

---

## 🎯 How to Use During a Meeting

1. Open any meeting on **[meet.jit.si](https://meet.jit.si)** (e.g., `https://meet.jit.si/DailyTeamHuddle`).
2. You will notice the floating **AI Assistant** button on the right side of the screen.
3. Click the button to open the **AI Assistant Sidebar**.
4. Click **"Start Recording"** (grant microphone permission when prompted).
5. Watch as your speech is transcribed and structured notes are generated in real time!
6. When the meeting is finished:
   - Click **"Stop"**
   - Review your summary, key decisions, and action items.
   - Click **"Upload to Drive"** or **"Export Markdown"**.

---

## 🛠️ Helpful Tips

| Feature | How to Use |
| :--- | :--- |
| **Move the Floating Button** | Click and drag the button up or down along the screen edge to place it wherever you prefer. |
| **Minimize to Badge** | Click the tiny **`–`** (minus) button on the floating widget to shrink it into a compact round badge so it never blocks video or controls. |
| **Auto-Hide** | When the AI sidebar is open, the floating button automatically hides so it never blocks the sidebar buttons. |
| **Resume Crashed Meeting** | If your browser tab closes unexpectedly, reopen the room within 24 hours — the plugin will alert you and let you restore your notes with 1 click. |

---

## ❓ Frequently Asked Questions (FAQ)

**Q: Does this cost anything?**  
**A:** No! The extension is completely open-source and free. Google Gemini Flash provides a generous free tier via Google AI Studio that easily covers daily meetings.

**Q: Can other participants see the plugin?**  
**A:** No. The extension runs locally in your browser. Other meeting participants will not see your AI notes or sidebar unless you choose to share your screen.

**Q: Where is my data stored?**  
**A:** Everything stays local in your browser's IndexedDB storage until you choose to upload it to your own personal Google Drive or download it as Markdown.

**Q: Why did credentials or old settings look pre-filled when I reloaded the extension?**  
**A:** Chrome preserves its internal database (`chrome.storage` and domain `localStorage`) even if you delete and redownload the `.zip` archive! To start completely fresh with clean inputs, click the **"🗑️ Clear All Stored Credentials & Reset"** button in the extension's **Settings** tab (or in the browser toolbar popup). This immediately wipes all cached test data and resets all fields to clean defaults.

**Q: The microphone is not transcribing?**  
**A:** Make sure you clicked "Allow" when the browser asked for microphone permissions for `meet.jit.si`. Chrome's built-in Web Speech API requires an active microphone.

---

*Need help or want to suggest a feature? Visit our [GitHub Repository](https://github.com/AKkKA1231/Jitsi-AI-Assistant-Vault-Sync) and open an issue!*
