# 🚀 Jitsi AI Assistant Vault & Sync: Colleague Quickstart Guide
**A Simple Step-by-Step Guide to Run the AI Assistant Plugin in Your Browser**

---

### 📌 What is This?
**Jitsi AI Assistant Vault & Sync** is a browser extension for **Jitsi Meet** calls (`meet.jit.si`). It automatically:
1. **Records multi-speaker call audio** (both you and all other meeting participants).
2. **Protects against lost recordings** using a local browser vault (even if your Wi-Fi dies or laptop sleeps).
3. **Transcribes audio & extracts action items** using Google Gemini Flash AI.
4. **Syncs recordings & notes directly to your personal Google Drive** (or downloads locally to your computer).

---

### ⏱️ 3-Minute Quick Setup

#### Step 1: Download the Extension
1. Open the GitHub repository:  
   👉 **[https://github.com/AKkKA1231/Jitsi-AI-Assistant-Vault-Sync](https://github.com/AKkKA1231/Jitsi-AI-Assistant-Vault-Sync)**
2. Click the green **Code** button > click **Download ZIP**.
3. Unzip/extract the folder on your computer. Inside you will find an **`extension/`** folder.  
   *(Or extract `jitsi-ai-assistant-plugin.zip` if available)*.

---

#### Step 2: Install into Chrome, Edge, or Brave
1. Open your browser and visit the extensions manager:
   * **Chrome**: `chrome://extensions`
   * **Edge**: `edge://extensions`
   * **Brave**: `brave://extensions`
2. Turn **ON** the **"Developer mode"** toggle (usually in the top-right corner).
3. Click the **"Load unpacked"** button (top-left).
4. Select the **`extension/`** folder from the files you extracted.
5. Done! You will see **"Jitsi AI Assistant & Google Drive Sync"** in your extensions list.
6. *(Tip)* Click the **puzzle piece (🧩)** icon in your browser toolbar and click the **Pin** icon next to the extension.

---

#### Step 3: Use in Any Jitsi Meeting
1. Open any Jitsi call room (e.g. [https://meet.jit.si/YourMeetingName](https://meet.jit.si/YourMeetingName)).
2. Look on the right side of the screen for the floating purple button:  
   `✨ AI Assistant & Meeting Notes`
3. Click the button to open the sidebar.
4. **Configure your AI Key (One-time)**:
   * Click **Settings (⚙️)**.
   * Paste your free Google Gemini API Key.  
     *(Don't have one? Get a free key in 30 seconds at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey))*.
   * The key **auto-saves automatically** for all future meetings!
5. When your call starts, click **"Start Recording"**.

---

### 💡 Tips for the Best Experience

#### 1. Zero-Obstruction Floating Button
* **Moving the button**: Click and drag the floating purple button up or down along the edge of your screen so it never blocks participant videos or call buttons.
* **Minimizing**: Click the small **`–`** on the button to shrink it into a tiny circular icon badge (`38px`). Click again to expand.
* **Auto-hides**: When you open the sidebar, the floating button automatically disappears so it never covers your notes or upload buttons!

#### 2. Connecting Your Personal Google Drive (Takes 60 Seconds)
Want meeting recordings (`.webm`) and notes (`.md`) saved directly to your Google Drive?
1. Open [GOOGLE_DRIVE_SETUP_GUIDE.md](GOOGLE_DRIVE_SETUP_GUIDE.md).
2. Copy the simple Google Apps Script snippet into [script.google.com](https://script.google.com).
3. Click **Deploy as Web App**, copy your private Webhook URL, and paste it into **Settings (⚙️)**.
4. Now whenever you click **Upload to Drive**, files go straight to your personal Drive folder!
*(If you don't configure Google Drive, clicking Upload safely downloads both files to your computer's **Downloads** folder instead)*.

#### 3. Accidental Disconnect or Wi-Fi Drop?
* If your laptop battery sleeps or Wi-Fi drops, **do not panic**!
* Reopen your meeting room. A yellow **"Interrupted Recording Recovered"** banner will appear.
* Click **"Transcribe Recovered"** or **"Save Audio"** to restore 100% of your call without data loss!

---

### ❓ Troubleshooting FAQ

* **Q: I don't see the floating button on the call?**  
  *A:* Make sure you are on a `meet.jit.si` room and refresh the page (`F5`) once after installing the extension.
* **Q: Does it record all participants or just me?**  
  *A:* It uses client-side Web Audio mixing to capture both your microphone AND the incoming voices of all other participants on the call.
* **Q: Is my API key private?**  
  *A:* Yes! Your Gemini key is saved locally in your own browser's sandboxed storage (`chrome.storage.sync`) and is never sent to any third-party server.
* **Q: How do I update to newer versions?**  
  *A:* Download or pull the latest repository files, go to `chrome://extensions`, and click the circular **Reload (🔄)** icon on the extension card.

