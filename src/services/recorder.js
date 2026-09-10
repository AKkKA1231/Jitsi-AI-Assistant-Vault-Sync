/**
 * Meeting Video & Audio Recorder Service
 * Uses browser MediaRecorder to capture meeting video + combined audio tracks (system & mic).
 */

export class MeetingRecorderService {
  constructor(options = {}) {
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.stream = null;
    this.isRecording = false;
    this.startTime = null;
    this.timerInterval = null;

    // Callbacks
    this.onTimerTick = options.onTimerTick || (() => {});
    this.onRecordingComplete = options.onRecordingComplete || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
  }

  /**
   * Start recording the screen/tab along with mixed audio
   */
  async startRecording() {
    if (this.isRecording) return;

    try {
      // Prompt user to select the Jitsi tab or screen with audio
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          frameRate: { ideal: 30, max: 60 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        }
      });

      // Optionally capture user's mic to mix in if available
      let micStream = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true
          }
        });
      } catch (err) {
        console.warn('Microphone permission not granted for recorder mix, proceeding with display audio only:', err);
      }

      // Combine audio tracks using AudioContext
      let finalAudioTracks = [];
      if (micStream && micStream.getAudioTracks().length > 0 && displayStream.getAudioTracks().length > 0) {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = audioCtx.createMediaStreamDestination();

        const sysSource = audioCtx.createMediaStreamSource(displayStream);
        const micSource = audioCtx.createMediaStreamSource(micStream);

        sysSource.connect(dest);
        micSource.connect(dest);

        finalAudioTracks = dest.stream.getAudioTracks();
      } else if (displayStream.getAudioTracks().length > 0) {
        finalAudioTracks = displayStream.getAudioTracks();
      } else if (micStream && micStream.getAudioTracks().length > 0) {
        finalAudioTracks = micStream.getAudioTracks();
      }

      // Compose final stream
      const combinedTracks = [
        ...displayStream.getVideoTracks(),
        ...finalAudioTracks
      ];

      this.stream = new MediaStream(combinedTracks);
      this.recordedChunks = [];

      // Determine mimeType
      let mimeType = 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/mp4';
        }
      }

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : undefined,
        videoBitsPerSecond: 2500000 // 2.5 Mbps
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this._handleRecordingStopped();
      };

      // Handle user stopping screen share via browser bar
      displayStream.getVideoTracks()[0].onended = () => {
        this.stopRecording();
      };

      this.mediaRecorder.start(1000); // 1-second chunks
      this.isRecording = true;
      this.startTime = Date.now();
      this._startTimer();

      this.onStateChange(true);
      return true;
    } catch (err) {
      console.error('Failed to start recording:', err);
      this.isRecording = false;
      this.onStateChange(false);
      throw err;
    }
  }

  /**
   * Stop recording
   */
  stopRecording() {
    if (!this.isRecording) return;

    this.isRecording = false;
    this._stopTimer();

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }

    this.onStateChange(false);
  }

  _startTimer() {
    this._stopTimer();
    this.timerInterval = setInterval(() => {
      const elapsedMs = Date.now() - this.startTime;
      const seconds = Math.floor((elapsedMs / 1000) % 60);
      const minutes = Math.floor((elapsedMs / (1000 * 60)) % 60);
      const hours = Math.floor(elapsedMs / (1000 * 60 * 60));

      const formatted = hours > 0
        ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

      this.onTimerTick(formatted, elapsedMs);
    }, 1000);
  }

  _stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  _handleRecordingStopped() {
    const mimeType = this.mediaRecorder?.mimeType || 'video/webm';
    const blob = new Blob(this.recordedChunks, { type: mimeType });
    const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const filename = `meeting_recording_${Date.now()}.${extension}`;

    const recordingResult = {
      blob,
      sizeBytes: blob.size,
      sizeMb: (blob.size / (1024 * 1024)).toFixed(2),
      filename,
      mimeType,
      durationMs: Date.now() - this.startTime
    };

    console.log('Recording finished:', recordingResult);
    this.onRecordingComplete(recordingResult);
  }
}
