# 🧩 Jitsi Meet AI Assistant & Google Drive Sync Plugin (Extension)

This browser extension allows you to use the AI Assistant and Google Drive sync **directly inside any call on `https://meet.jit.si` or `https://jitsi.org`**!

---

## ⚡ How to Load the Plugin in 15 Seconds (Chrome, Edge, Brave)

1. Open your browser and go to:
   - Chrome / Brave: `chrome://extensions`
   - Microsoft Edge: `edge://extensions`
2. In the top right corner, toggle **Developer mode** to **ON**.
3. Click the **Load unpacked** button in the top left.
4. Select this folder:
   ```
   C:\Users\ADMIN\.gemini\antigravity-ide\scratch\jitsi-ai-assistant\extension
   ```
5. Done! The **Meetings_AI Assistant** extension is now installed.

---

## 🚀 How to Use on Jitsi Calls

1. Open any Jitsi call, for example:
   👉 **`https://meet.jit.si/your-meeting-name`**
2. In the bottom-right corner of your call, you will see the floating **🤖 AI Notes & Drive Sync** button.
3. Click it to open the real-time assistant sidebar right inside your call:
   - **Continuous Speech-to-Text**: Captures your voice live with speaker tags and timestamps.
   - **Real-Time AI Notes**: Automatically extracts **Key Decisions** and **Action Items with Checkboxes**.
   - **1-Click Google Drive Quota Switcher**: Check remaining free 15 GB storage, and switch to Account 2 / update ID & Password with 1 click.
   - **Upload to Drive**: Exports your executive summary and transcript directly to your Google Drive archive folder.

---

## 🌐 Also Available as Standalone Web App
If you prefer running the full dashboard side-by-side with your meeting, run:
```bash
python -m http.server 3000
```
and open `http://localhost:3000`!
