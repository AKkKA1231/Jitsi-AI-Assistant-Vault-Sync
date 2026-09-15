# Meetings_AI Assistant & Google Drive Sync (Free Account Plugin)

A turnkey, zero-cost solution for **Jitsi Meet** calls featuring:
1. **Real-time Speech-to-Text (STT)**: Continuous streaming transcription directly inside the browser using Web Speech API — works 100% free with any `meet.jit.si` room without requiring Jigasi telephony or paid 8x8 JaaS tokens.
2. **Autonomous AI Note Taker**: Captures key decisions, action items with checkboxes, and discussion points during the call, plus generates comprehensive executive meeting minutes when the call ends.
3. **Automated Call Recording & Drive Sync**: Records meeting video and dual-track mixed audio (system + microphone), compiles everything, and uploads directly to Google Drive.
4. **Instant Credential / Quota Switcher**: Simple ID/Password/Token management. When a free 15 GB Google Drive storage fills up, switch to Account 2 or update credentials in 1 click without stopping workflow.

---

## 📁 Project Structure

```
jitsi-ai-assistant/
├── index.html              # Main application shell with Jitsi viewport & AI sidebar
├── README.md               # Documentation & quick start guide
├── package.json            # Lightweight dev server scripts
└── src/
    ├── style.css           # Modern dark-mode styling with glassmorphism & responsive layout
    ├── app.js              # Master application controller and event bus
    └── services/
        ├── jitsi.js        # Jitsi Meet External API integration
        ├── transcription.js# Web Speech API streaming transcription engine
        ├── aiNotes.js      # Real-time note extraction & post-meeting summary generator
        ├── recorder.js     # MediaRecorder video & dual-track mixed audio recording
        └── googleDrive.js  # Multi-account Google Drive quota manager & uploader
```

---

## 🚀 Quick Start

### Option 1: Open Directly in Browser
Because the application uses native browser APIs and standard ES modules, you can serve it with any local static HTTP server (e.g. VS Code Live Server, Python HTTP server, or Node `http-server` / `npx serve`):

```bash
# Using npx serve (recommended)
npx -y serve C:\Users\ADMIN\.gemini\antigravity-ide\scratch\jitsi-ai-assistant

# Or using Python
python -m http.server 3000 --directory C:\Users\ADMIN\.gemini\antigravity-ide\scratch\jitsi-ai-assistant
```
Then open `http://localhost:3000` in Google Chrome, Microsoft Edge, or Brave.

---

## 🎯 How It Solves Your Manager's Requirements

### 1. "Jitsi Speech to text automatic plugin with jitsi free account.. so we don't have to switch"
- Standard `meet.jit.si` locks recording and transcription behind paid accounts.
- This application embeds the official Jitsi Meet interface (`meet.jit.si/external_api.js`) side-by-side with an automated STT engine.
- Speech is captured continuously from the participants and rendered with speaker tags and timestamps with zero lag.

### 2. "During call, we'll have AI take notes"
- As speech is transcribed, the AI engine extracts **Key Decisions** and **Action Items with Checkboxes** in real-time in the sidebar.
- Participants can review takeaways live while talking.

### 3. "Post call, we'll have AI take notes and record video upload default to google drive"
- When you click **Leave Call** or close the meeting, the system automatically:
  1. Generates an executive Markdown meeting summary.
  2. Compiles the video recording (`.mp4` / `.webm`).
  3. Prepares the full timestamped transcript (`.json`).
  4. Automatically packages and launches the Google Drive upload pipeline.

### 4. "add Id password so once space is over simple update ID password"
- Click the **Drive: Account 1** chip or the ⚙️ **Settings** button in the header.
- View real-time storage remaining on your 15 GB free Google accounts.
- **When storage runs out**:
  - Switch to **Account 2 (Backup)** with 1 click, OR
  - Update the Client ID and Password / Token in the simple input box and click **Save**.
- Seamless rollover with zero downtime!
