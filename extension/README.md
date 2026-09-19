# 🎙️ Meetings_AI Assistant & Drive Sync — Browser Extension

This browser extension gives you real-time AI transcription, action items extraction, meeting recording with crash vault recovery, automated Google Drive archiving, and Slack notifications **directly inside any Jitsi meeting (`https://meet.jit.si`) or Google Meet call (`https://meet.google.com`)**.

---

## ⚡ How to Install in 30 Seconds (Chrome, Edge, Brave)

1. **Extract this ZIP file** to any folder on your computer (e.g. `Documents/Meetings_AI_Assistant` or `Downloads/Meetings_AI_Assistant`).
2. Open your browser and go to your extensions page:
   - **Chrome / Brave**: `chrome://extensions`
   - **Microsoft Edge**: `edge://extensions`
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click the **"Load unpacked"** button in the top-left corner.
5. Select the unzipped folder containing `manifest.json`.
6. 🎉 **Done!** The **Meetings_AI Assistant** extension is now installed.

---

## 🔑 Configure Your Free Gemini API Key (1 Minute)

1. Get a free Gemini API key in 30 seconds from [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Click the extension icon in your browser toolbar (or open any Jitsi meeting).
3. Open the **⚙️ Settings** tab.
4. Paste your API key in the **Gemini API Key** box and click **"💾 Save Gemini Key"**.
5. Click **"🔔 Test Gemini Key"** to verify connection. You'll see: `✅ Connected! Verified with gemini-2.0-flash-lite`.
   > 🔒 *Your API key is stored locally in your browser's private storage (`chrome.storage.local`). It is never transmitted to any third party.*

---

## 🚀 How to Use in Your Meetings

1. Join any meeting on [meet.jit.si](https://meet.jit.si/) or Google Meet.
2. In the bottom-right corner, you'll see the floating **🤖 AI Assistant** widget.
3. Click **"🎙️ Start Recording"**:
   - Audio is continuously sliced and protected in an IndexedDB vault (zero recording loss even if browser crashes).
   - Gemini models transcribe speech blocks every few minutes in the background.
   - Action items, decisions, and executive summaries update live.
4. When finished, click **"⏹️ Stop Recording"**:
   - The final summary and audio recording are compiled instantly.
   - You can download notes and audio locally, or auto-upload directly to Google Drive.

---

## ☁️ Google Drive & Slack Setup (Optional)

- See `GOOGLE_DRIVE_SETUP_GUIDE.md` inside this folder for copy-paste Google Apps Script code to sync notes & audio directly to your Google Drive.
- See `COLLEAGUE_SETUP_GUIDE.md` for a complete step-by-step onboarding guide.
