# 🚀 Jitsi AI Assistant Vault & Sync: Quickstart Guide
**One-Page Setup Guide for Colleagues & Team Members**

---

### 📌 Overview
**Jitsi AI Assistant Vault & Sync** is a lightweight Chrome extension that runs seamlessly inside your Jitsi Meet calls. It captures multi-speaker audio, automatically transcribes and extracts meeting summaries via Google Gemini AI, and protects against connection loss using a resilient IndexedDB audio vault.

---

### ⏱️ 3-Minute Setup (Step-by-Step)

#### Step 1: Download & Unpack the Extension
1. Open the GitHub repository:  
   👉 **[GitHub Repo](https://github.com/AKkKA1231/Jitsi-AI-Assistant-Vault-Sync)**
2. Click **Code** > **Download ZIP** (or clone the repository):
   ```bash
   git clone https://github.com/AKkKA1231/Jitsi-AI-Assistant-Vault-Sync.git
   ```
3. Extract the downloaded ZIP file to a folder on your computer. Inside, you will see an `extension/` folder.  
   *(Alternatively, you can extract `jitsi-ai-assistant-plugin.zip` directly into an `extension` folder)*.

---

#### Step 2: Load into Google Chrome / Edge / Brave
1. Open your browser and go to the extensions page:
   - **Chrome**: Type `chrome://extensions` in the URL bar.
   - **Edge**: Type `edge://extensions`.
   - **Brave**: Type `brave://extensions`.
2. Toggle on **"Developer mode"** in the top-right corner.
3. Click the **"Load unpacked"** button in the top-left menu.
4. Select the **`extension`** folder from the extracted files.
5. You will see **"Jitsi AI Assistant & Google Drive Sync"** appear in your extension list!
6. *(Recommended)* Click the puzzle piece icon in your Chrome toolbar and **pin** the extension.

---

#### Step 3: Run in a Jitsi Meet Call
1. Navigate to any Jitsi Meet meeting room (e.g. `https://meet.jit.si/YourTeamRoom`).
2. You will notice a floating **"AI Assistant"** floating button appear on the right edge of your screen.
3. Click the button to open the sidebar.
4. **Configure your API Key**:
   - Click the **Settings (⚙️)** icon in the sidebar.
   - Enter your **Google Gemini API Key** ([Get a free key here](https://aistudio.google.com/app/apikey)).
   - *(Optional)* Add your Google Drive accounts if you wish to auto-sync meeting archives.
5. Click **"Start Recording"** when your meeting begins.

---

### 🛡️ Why It's Built Differently (Zero Recording Loss)
* **Crash-Proof Vault**: Audio is sliced in 5-second resilient intervals and saved into local browser storage (IndexedDB).
* **Accidental Disconnect Protection**: If your Wi-Fi drops, tab closes, or battery dies, simply reopen the Jitsi room. A yellow **"Meeting Interruption Detected"** recovery banner will appear—click **"Restore Recording"** to salvage 100% of your call audio.
* **Instant AI Minutes**: At the end of the call, click **"Generate AI Summary"** to get structured key decisions, action items with owners, and complete transcripts.

---

### ❓ Quick Troubleshooting
* **Floating widget not showing?** Make sure you are on a `meet.jit.si` URL or your company's self-hosted Jitsi domain. Refresh the page once after installing.
* **Audio not capturing?** Ensure your browser has granted microphone permission to the Jitsi tab.
* **Need to update?** Go to `chrome://extensions` and click the reload (🔄) icon on the extension card.
