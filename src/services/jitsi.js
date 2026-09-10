/**
 * Jitsi Meet External API Service
 * Handles room initialization, participant events, mute tracking, and conference lifecycle.
 */

export class JitsiService {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.domain = options.domain || localStorage.getItem('jitsi_custom_domain') || 'meet.jit.si';
    this.api = null;
    this.roomName = null;
    this.userName = null;
    this.onJoined = options.onJoined || (() => {});
    this.onLeft = options.onLeft || (() => {});
    this.onParticipantJoined = options.onParticipantJoined || (() => {});
    this.onAudioMuteChanged = options.onAudioMuteChanged || (() => {});
  }

  setDomain(domain) {
    if (domain) {
      this.domain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      localStorage.setItem('jitsi_custom_domain', this.domain);
    }
  }

  /**
   * Join or switch to a Jitsi room
   */
  joinRoom(roomName, userName = 'Guest') {
    this.roomName = roomName.trim().replace(/\s+/g, '-');
    this.userName = userName.trim() || 'Guest';

    // Dispose existing instance if present
    if (this.api) {
      this.api.dispose();
      this.api = null;
    }

    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error(`Container #${this.containerId} not found`);
      return;
    }

    // Clear empty state
    const emptyState = document.getElementById('jitsiEmptyState');
    if (emptyState) {
      emptyState.style.display = 'none';
    }

    const options = {
      roomName: this.roomName,
      parentNode: container,
      width: '100%',
      height: '100%',
      userInfo: {
        displayName: this.userName
      },
      configOverwrite: {
        startWithAudioMuted: false,
        startWithVideoMuted: false,
        enableWelcomePage: false,
        prejoinPageEnabled: false,
        disableDeepLinking: true,
        defaultRemoteDisplayName: 'Participant'
      },
      interfaceConfigOverwrite: {
        TOOLBAR_BUTTONS: [
          'microphone', 'camera', 'closedcaptions', 'desktop', 'embedmeeting', 'fullscreen',
          'fodeviceselection', 'hangup', 'profile', 'chat', 'recording',
          'livestreaming', 'etherpad', 'sharedvideo', 'settings', 'raisehand',
          'videoquality', 'filmstrip', 'invite', 'feedback', 'stats', 'shortcuts',
          'tileview', 'videobackgroundblur', 'download', 'help', 'mute-everyone', 'security'
        ],
        SHOW_JITSI_WATERMARK: false,
        SHOW_WATERMARK_FOR_GUESTS: false,
        SHOW_BRAND_WATERMARK: false
      }
    };

    if (typeof window.JitsiMeetExternalAPI === 'undefined') {
      console.warn('JitsiMeetExternalAPI script is still loading, attempting to retry...');
      setTimeout(() => this.joinRoom(roomName, userName), 1000);
      return;
    }

    try {
      this.api = new window.JitsiMeetExternalAPI(this.domain, options);
      this._bindEvents();
    } catch (err) {
      console.error('Failed to instantiate Jitsi Meet API:', err);
    }
  }

  _bindEvents() {
    if (!this.api) return;

    this.api.addEventListener('videoConferenceJoined', (data) => {
      console.log('Joined Jitsi conference:', data);
      this.onJoined(data);
    });

    this.api.addEventListener('videoConferenceLeft', () => {
      console.log('Left Jitsi conference');
      this.onLeft();
    });

    this.api.addEventListener('participantJoined', (participant) => {
      console.log('Participant joined:', participant);
      this.onParticipantJoined(participant);
    });

    this.api.addEventListener('audioMuteStatusChanged', (status) => {
      this.onAudioMuteChanged(status.muted);
    });
  }

  hangup() {
    if (this.api) {
      this.api.executeCommand('hangup');
    }
  }

  getRoomName() {
    return this.roomName || 'General-Meeting';
  }

  getUserName() {
    return this.userName || 'Participant';
  }
}
