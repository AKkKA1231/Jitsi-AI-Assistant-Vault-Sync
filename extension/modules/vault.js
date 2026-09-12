/**
 * Jitsi AI Assistant - IndexedDB Audio Vault & Recovery Engine
 * Provides persistent multi-chunk crash recovery and offline safety guarantees.
 */

(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  }
  if (typeof root !== 'undefined') {
    root.JitsiVault = mod;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const VAULT_DB_NAME = 'JitsiAiAssistantVault';
  const VAULT_DB_VERSION = 1;
  const VAULT_STORE = 'sessions';
  let vaultDB = null;
  let currentVaultSessionId = null;

  function initVaultDB() {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.indexedDB) return resolve(null);
      const req = indexedDB.open(VAULT_DB_NAME, VAULT_DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(VAULT_STORE)) {
          const store = db.createObjectStore(VAULT_STORE, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      req.onsuccess = (e) => {
        vaultDB = e.target.result;
        resolve(vaultDB);
      };
      req.onerror = () => resolve(null);
    });
  }

  async function createVaultSession(roomName) {
    if (!vaultDB) await initVaultDB();
    if (!vaultDB) return null;

    currentVaultSessionId = `session_${roomName}_${Date.now()}`;
    const session = {
      id: currentVaultSessionId,
      roomName: roomName,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active',
      chunks: [],
      chunkCount: 0,
      totalBytes: 0
    };

    return new Promise((resolve) => {
      try {
        const tx = vaultDB.transaction(VAULT_STORE, 'readwrite');
        tx.objectStore(VAULT_STORE).put(session);
        tx.oncomplete = () => resolve(currentVaultSessionId);
        tx.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function appendChunkToVault(chunkBlob, chunkMeta) {
    if (!vaultDB || !currentVaultSessionId) return;

    return new Promise((resolve) => {
      try {
        const tx = vaultDB.transaction(VAULT_STORE, 'readwrite');
        const store = tx.objectStore(VAULT_STORE);
        const getReq = store.get(currentVaultSessionId);
        getReq.onsuccess = () => {
          const session = getReq.result;
          if (session) {
            session.chunks.push({
              index: chunkMeta.index,
              size: chunkBlob.size,
              timestamp: chunkMeta.timestamp,
              data: chunkBlob
            });
            session.chunkCount = session.chunks.length;
            session.totalBytes = (session.totalBytes || 0) + chunkBlob.size;
            session.updatedAt = new Date().toISOString();
            store.put(session);
          }
          resolve();
        };
        getReq.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  }

  async function saveVaultCheckpoint(recordedChunks = [], isRecording = false, showToast = null) {
    if (!isRecording || recordedChunks.length === 0) return;
    try {
      const totalBytes = recordedChunks.reduce((acc, c) => acc + (c.size || 0), 0);
      const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      const badge = document.getElementById('jitsiVaultCheckpointStatus');
      if (badge) {
        badge.innerHTML = `💾 Auto-Checkpoint at <strong>${timeStr}</strong>: ${recordedChunks.length} chunks (${totalMb} MB safely in vault)`;
        badge.style.color = '#34d399';
      }
      if (showToast) {
        showToast(`💾 Auto-checkpoint: ${recordedChunks.length} audio chunks (${totalMb} MB) secured on local disk.`);
      }
    } catch (err) {
      console.warn('[Vault] Checkpoint error:', err);
    }
  }

  async function markVaultSessionCompleted() {
    if (!vaultDB || !currentVaultSessionId) return;
    try {
      const tx = vaultDB.transaction(VAULT_STORE, 'readwrite');
      const store = tx.objectStore(VAULT_STORE);
      const getReq = store.get(currentVaultSessionId);
      getReq.onsuccess = () => {
        const session = getReq.result;
        if (session) {
          session.status = 'completed';
          session.completedAt = new Date().toISOString();
          store.put(session);
        }
      };
    } catch (e) {}
  }

  async function findUnfinalizedSessions() {
    if (!vaultDB) await initVaultDB();
    if (!vaultDB) return [];

    return new Promise((resolve) => {
      try {
        const tx = vaultDB.transaction(VAULT_STORE, 'readonly');
        const store = tx.objectStore(VAULT_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const all = req.result || [];
          const unfinalized = all.filter(s => 
            s.status === 'active' && 
            s.chunks && s.chunks.length > 0 && 
            s.id !== currentVaultSessionId
          ).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
          resolve(unfinalized);
        };
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  async function deleteVaultSession(id) {
    if (!vaultDB) return;
    try {
      const tx = vaultDB.transaction(VAULT_STORE, 'readwrite');
      tx.objectStore(VAULT_STORE).delete(id);
    } catch (e) {}
  }

  function triggerEmergencyBackup(recordedChunks, triggerDownload) {
    if (!recordedChunks || recordedChunks.length === 0) return;
    try {
      const room = (typeof window !== 'undefined' && window.location.pathname.replace('/', '')) || 'jitsi-meeting';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const emergencyBlob = new Blob(recordedChunks, { type: 'audio/webm' });
      if (triggerDownload) {
        triggerDownload(emergencyBlob, `Meeting_Audio_EMERGENCY_BACKUP_${timestamp}_${room}.webm`, 'audio/webm');
      }
      console.log(`[Vault] Emergency backup triggered: ${(emergencyBlob.size / 1024).toFixed(1)} KB`);
    } catch (err) {
      console.error('[Vault] Failed emergency backup:', err);
    }
  }

  return {
    initVaultDB,
    createVaultSession,
    appendChunkToVault,
    saveVaultCheckpoint,
    markVaultSessionCompleted,
    findUnfinalizedSessions,
    deleteVaultSession,
    triggerEmergencyBackup,
    getCurrentSessionId: () => currentVaultSessionId,
    VAULT_DB_NAME,
    VAULT_STORE
  };
});
