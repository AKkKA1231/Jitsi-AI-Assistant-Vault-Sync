# 🎙️ Jitsi AI Assistant & Drive Sync — Colleague Setup Guide

Welcome to the **Jitsi AI Assistant & Vault Sync** browser plugin! This guide will help you install and run the extension in **Chrome, Edge, or Brave** in less than 3 minutes.

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

### Step 1: Download & Unpack the Extension
1. Clone or download the repository from GitHub:
   ```bash
   git clone https://github.com/AKkKA1231/Jitsi-AI-Assistant-Vault-Sync.git
   ```
   *(Or download the ZIP from GitHub: click **Code** → **Download ZIP**, then extract it to a folder on your computer).*
2. Look inside the folder — you will see a folder named `extension/`. That is your plugin!

---

### Step 2: Load the Extension in Your Browser
You can use **Google Chrome**, **Microsoft Edge**, or **Brave**:

1. Open your browser and go to your extensions manager:
   - **Chrome**: Navigate to `chrome://extensions`
   - **Edge**: Navigate to `edge://extensions`
   - **Brave**: Navigate to `brave://extensions`
2. In the top-right corner, turn **ON** **"Developer mode"** (toggle switch).
3. Click the **"Load unpacked"** button in the top-left corner.
4. Select the `extension/` folder from the project directory.
5. 🎉 **Done!** You will now see **"Jitsi AI Assistant & Vault Sync"** in your list of extensions.

---

### Step 3: Enter Your Free Gemini API Key
The assistant uses Google's ultra-fast Gemini Flash model to generate notes and action items.

1. Get a free API key in 30 seconds from [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Click the puzzle icon in your browser toolbar to open the extension popup (or open any Jitsi meeting).
3. Open the **Settings** tab (⚙️ gear icon).
4. Paste your API key into the **Gemini API Key** box and click **Save Settings**.
   > 💡 *Your key is saved locally in your own browser's secure storage (`chrome.storage.local`). It is never shared or sent to any third-party server.*

---

### Step 4 (Optional): Connect Your Google Drive
If you want meeting notes and audio recordings automatically uploaded to your Google Drive:

1. Open [script.new](https://script.new) in your browser.
2. Replace all existing code with this Google Apps Script:
   ```javascript
   function doPost(e) {
     try {
       var data = JSON.parse(e.postData.contents);
       var mainFolder = DriveApp.getFoldersByName(data.folderName || "Jitsi_Meetings");
       var parentFolder = mainFolder.hasNext() ? mainFolder.next() : DriveApp.createFolder(data.folderName || "Jitsi_Meetings");
       
       var room = data.roomName || "Meeting";
       var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT", "yyyy-MM-dd_HH-mm");
       var subFolder = parentFolder.createFolder(room + "_" + dateStr);
       
       // 1. Save Meeting Summary & Action Items (.md)
       var mdText = data.markdownText || data.fileContent || "# Meeting Summary\n\nAudio attached.";
       var mdFile = subFolder.createFile(data.markdownFileName || data.fileName || "Meeting_Summary.md", mdText, "text/markdown");
       
       // 2. Save Audio Recording (.webm)
       var audioUrl = null;
       var audioBase64 = data.audioBase64 || data.base64Audio;
       if (audioBase64 && audioBase64.length > 0) {
         var audioBytes = Utilities.base64Decode(audioBase64);
         var audioBlob = Utilities.newBlob(audioBytes, data.audioMimeType || "audio/webm", data.audioFileName || "Meeting_Audio.webm");
         var audioFile = subFolder.createFile(audioBlob);
         audioUrl = audioFile.getUrl();
       }
       
       return ContentService.createTextOutput(JSON.stringify({
         success: true,
         folderId: subFolder.getId(),
         folderUrl: subFolder.getUrl(),
         notesUrl: mdFile.getUrl(),
         audioUrl: audioUrl
       })).setMimeType(ContentService.MimeType.JSON);
     } catch (err) {
       return ContentService.createTextOutput(JSON.stringify({
         success: false,
         error: err.toString()
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

**Q: The microphone is not transcribing?**  
**A:** Make sure you clicked "Allow" when the browser asked for microphone permissions for `meet.jit.si`. Chrome's built-in Web Speech API requires an active microphone.

---

*Need help or want to suggest a feature? Visit our [GitHub Repository](https://github.com/AKkKA1231/Jitsi-AI-Assistant-Vault-Sync) and open an issue!*
