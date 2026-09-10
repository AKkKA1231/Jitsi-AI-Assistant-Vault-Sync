/**
 * Real-Time Continuous Speech-to-Text Service
 * Free & Unlimited in browser using Web Speech API (SpeechRecognition)
 */

export class TranscriptionService {
  constructor(options = {}) {
    this.recognition = null;
    this.isListening = false;
    this.shouldRestart = false;
    this.language = options.language || 'en-US';
    this.currentSpeaker = options.speaker || 'You';

    // Callbacks
    this.onTranscriptChunk = options.onTranscriptChunk || (() => {});
    this.onInterimResult = options.onInterimResult || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});

    // State
    this.transcripts = [];

    this._initSpeechRecognition();
  }

  _initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('SpeechRecognition API not supported in this browser. Will use simulated STT fallback.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.language;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.onStatusChange({ listening: true, text: 'Microphone listening' });
    };

    this.recognition.onresult = (event) => {
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcriptPart = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          this._handleFinalTranscript(transcriptPart.trim());
        } else {
          interim += transcriptPart;
        }
      }

      if (interim) {
        this.onInterimResult(interim);
      }
    };

    this.recognition.onerror = (event) => {
      console.warn('Speech recognition event:', event.error);
      if (event.error === 'not-allowed') {
        this.onStatusChange({ listening: false, text: 'Mic access blocked' });
        this.shouldRestart = false;
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      if (this.shouldRestart) {
        try {
          this.recognition.start();
        } catch (e) {
          // ignore already started error
        }
      } else {
        this.onStatusChange({ listening: false, text: 'Microphone paused' });
      }
    };
  }

  setSpeaker(name) {
    this.currentSpeaker = name;
  }

  _handleFinalTranscript(text) {
    if (!text || text.length < 2) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const entry = {
      id: Date.now() + Math.random().toString(36).substr(2, 4),
      speaker: this.currentSpeaker,
      text: text,
      timestamp: timeStr,
      rawTime: now.toISOString()
    };

    this.transcripts.push(entry);
    this.onTranscriptChunk(entry, this.transcripts);
    this.onInterimResult('');
  }

  /**
   * Simulate a speech transcript entry (useful for automated testing or offline demos)
   */
  simulateSpeech(text, speaker = null) {
    const prevSpeaker = this.currentSpeaker;
    if (speaker) this.currentSpeaker = speaker;
    this._handleFinalTranscript(text);
    if (speaker) this.currentSpeaker = prevSpeaker;
  }

  start() {
    this.shouldRestart = true;
    if (this.recognition && !this.isListening) {
      try {
        this.recognition.start();
      } catch (err) {
        console.warn('Could not start recognition directly:', err);
      }
    } else {
      this.onStatusChange({ listening: true, text: 'STT Active' });
    }
  }

  stop() {
    this.shouldRestart = false;
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (err) {
        console.warn('Error stopping recognition:', err);
      }
    }
    this.isListening = false;
    this.onStatusChange({ listening: false, text: 'STT Paused' });
  }

  toggle() {
    if (this.isListening) {
      this.stop();
      return false;
    } else {
      this.start();
      return true;
    }
  }

  clear() {
    this.transcripts = [];
  }

  getTranscripts() {
    return [...this.transcripts];
  }

  getFullText() {
    return this.transcripts.map(t => `[${t.timestamp}] ${t.speaker}: ${t.text}`).join('\n');
  }
}
