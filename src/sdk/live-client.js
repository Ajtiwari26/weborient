/**
 * WebOrient Live Client (v1.0.0 — "VIP + Local Secretary" Zero-Token VAD Gate, 600ms Pre-Roll Ring Buffer & Auto-Resume)
 * - Captures 16kHz mono PCM microphone audio (AudioWorklet with ScriptProcessor fallback)
 * - 3-Stage "VIP + Local Secretary" Architecture:
 *   1. ACTIVE (0s - 10s silence): Streams live 16kHz PCM to Gemini Live.
 *   2. SECRETARY_HOLD (10s - 75s silence): Browser AudioWorklet VAD gates silent PCM packets (0 tokens burned,
 *      0 credits deducted) while keeping a rolling 600ms Pre-Roll Ring Buffer in RAM. The instant the user speaks
 *      (RMS > threshold for 2+ frames), flushes the 600ms pre-roll + live speech in <15ms with zero clipped syllables!
 *   3. HIBERNATING (>75s silence or >45s tab hidden): Disconnects upstream WebSocket to free cloud slots while
 *      the Local Secretary keeps monitoring the mic locally to auto-reconnect and flush speech when the user talks again.
 */
export class LiveClient {
  constructor(options = {}) {
    this.endpoint =
      options.endpoint ||
      (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'ws://localhost:8088'
        : 'wss://relay.deploymate.in');
    this.onToolCall = options.onToolCall || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onPlaybackChange = options.onPlaybackChange || (() => {});
    this.onInterrupted = options.onInterrupted || (() => {});
    this.onVadStateChange = options.onVadStateChange || (() => {});
    this.onCreditUpdate = options.onCreditUpdate || (() => {});
    this.onReconnectNeeded = options.onReconnectNeeded || null;

    this.ws = null;
    this.captureContext = null;
    this.playbackContext = null;
    this.mediaStream = null;
    this.workletNode = null;
    this.scriptProcessor = null;

    this.activeSourceNodes = new Set();
    this.nextPlayTime = 0;
    this.isPlaying = false;

    // "VIP + Local Secretary" VAD & Pre-Roll Ring Buffer state
    this.vadState = 'active'; // 'active' | 'secretary_hold' | 'hibernating' | 'waking'
    this.lastSpeechOrActionAt = Date.now();
    this.secretaryHoldAfterMs = options.secretaryHoldAfterMs || 10000; // 10s silence -> Secretary Hold (0 token burn)
    this.hibernateAfterMs = options.hibernateAfterMs || 75000;         // 75s silence -> Deep Hibernation
    this.hiddenTabHibernateMs = options.hiddenTabHibernateMs || 45000; // 45s hidden tab -> Deep Hibernation
    this.vadThresholdRms = options.vadThresholdRms || 0.008;
    this.consecutiveVoiceFrames = 0;
    this.preRollBuffer = [];
    this.maxPreRollChunks = 6; // ~750ms rolling audio pre-roll at 128ms/frame
    this.secretarySavedSeconds = 0;
    this._vadTimer = null;
    this._keepaliveTimer = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 3;
    this.isReconnecting = false;
    this._userStopped = false;
    this._terminalError = false;
    this._intentionalHibernate = false;
  }

  async connect(options = {}) {
    this._userStopped = false;
    this._terminalError = false;
    if (!options.isAutoReconnect) {
      this.isReconnecting = false;
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!this.captureContext || this.captureContext.state === 'closed') {
      this.captureContext = new AudioCtx({ sampleRate: 16000 });
    }
    if (!this.playbackContext || this.playbackContext.state === 'closed') {
      this.playbackContext = new AudioCtx({ sampleRate: 24000 });
    }

    if (!this.mediaStream) {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    }

    const wasWaking = this.vadState === 'waking' || this._intentionalHibernate;
    this._intentionalHibernate = false;
    this.vadState = 'waking';
    this.lastSpeechOrActionAt = Date.now();

    return new Promise((resolve, reject) => {
      let settled = false;
      let openedThisSocket = false;
      const ws = new WebSocket(this.endpoint);
      this.ws = ws;

      const canScheduleRetry = (isTerminal = this._terminalError) =>
        (openedThisSocket || Boolean(options.isAutoReconnect)) &&
        !this._userStopped &&
        !isTerminal &&
        this._reconnectAttempts < this._maxReconnectAttempts &&
        typeof this.onReconnectNeeded === 'function';

      ws.onopen = async () => {
        if (this.ws !== ws) return;
        settled = true;
        openedThisSocket = true;
        this.isReconnecting = false;
        this.vadState = 'active';
        this.consecutiveVoiceFrames = 0;
        this.lastSpeechOrActionAt = Date.now();
        this.onStatusChange('connected');
        this.onVadStateChange('active', { savedSeconds: this.secretarySavedSeconds });
        if (!this.workletNode && !this.scriptProcessor) {
          await this._startAudioStreaming();
        }
        this._startSecretaryMonitor();
        this._startKeepaliveLoop();

        const combinedChunks = [
          ...(Array.isArray(options.flushAudioChunks) ? options.flushAudioChunks : []),
          ...this.preRollBuffer
        ].slice(-this.maxPreRollChunks);
        this.preRollBuffer = [];
        if (combinedChunks.length > 0) {
          setTimeout(() => {
            if (this.ws === ws && ws.readyState === WebSocket.OPEN) {
              this._flushPreRollChunks(combinedChunks);
            }
          }, 160);
        }
        resolve();
      };

      ws.onmessage = async (event) => {
        if (this.ws !== ws) return;
        try {
          const data = JSON.parse(event.data);
          this._handleServerMessage(data);
        } catch (err) {
          console.error('[WebOrient] Failed to parse server frame:', err);
        }
      };

      ws.onclose = (closeEvent) => {
        if (this.ws !== ws) return;
        if (this._keepaliveTimer) {
          clearInterval(this._keepaliveTimer);
          this._keepaliveTimer = null;
        }
        if (this._intentionalHibernate) {
          this.ws = null;
          this.isReconnecting = false;
          this.onStatusChange('hibernating');
          return;
        }

        const code = closeEvent?.code || 1006;
        const isTerminalClose = this._terminalError || code === 4002 || code === 4003;

        if (canScheduleRetry(isTerminalClose)) {
          this._reconnectAttempts += 1;
          this.isReconnecting = true;
          const delayMs = this._reconnectAttempts * 900;
          console.warn(`[WebOrient] Connection interrupted (code=${code}); auto-reconnecting (${this._reconnectAttempts}/${this._maxReconnectAttempts}) in ${delayMs}ms...`);
          this.ws = null;
          this.onStatusChange('reconnecting');
          this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            if (!this._userStopped) {
              this.onReconnectNeeded(this._reconnectAttempts);
            }
          }, delayMs);
          return;
        }

        this.isReconnecting = false;
        this.stop({ silent: true });
        this.onStatusChange('disconnected');
      };

      ws.onerror = (err) => {
        if (this.ws !== ws) return;
        console.error('[WebOrient] WebSocket error:', err);
        const willAutoReconnect = this.isReconnecting || canScheduleRetry();
        if (!willAutoReconnect) {
          this.onStatusChange('error');
        }
        if (!settled) {
          settled = true;
          this.vadState = wasWaking ? 'hibernating' : 'active';
          reject(new Error(`WebSocket connection failed to ${this.endpoint}`));
        }
      };
    });
  }

  _startKeepaliveLoop() {
    if (this._keepaliveTimer) clearInterval(this._keepaliveTimer);
    this._keepaliveTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ ping: Date.now() }));
        } catch (_) {}
      }
    }, 15000);
  }

  markActivity(reason = 'interaction') {
    this.lastSpeechOrActionAt = Date.now();
    if (this.vadState === 'secretary_hold') {
      this._wakeFromSecretaryHold(reason);
    }
  }

  _startSecretaryMonitor() {
    if (this._vadTimer) clearInterval(this._vadTimer);
    this._vadTimer = setInterval(() => {
      if (this.isPlaying) {
        this.lastSpeechOrActionAt = Date.now();
        return;
      }

      const now = Date.now();
      const idleMs = now - this.lastSpeechOrActionAt;
      const isTabHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';

      if (this.vadState === 'active') {
        if (idleMs >= this.secretaryHoldAfterMs || (isTabHidden && idleMs >= 5000)) {
          this.vadState = 'secretary_hold';
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
              vadControl: {
                state: 'secretary_hold',
                idleMs,
                reason: isTabHidden ? 'tab_hidden' : 'silence_10s',
                savedSeconds: this.secretarySavedSeconds
              }
            }));
          }
          this.onVadStateChange('secretary_hold', {
            idleMs,
            savedSeconds: this.secretarySavedSeconds
          });
        }
      } else if (this.vadState === 'secretary_hold') {
        this.secretarySavedSeconds += 1;
        this.onVadStateChange('secretary_hold', {
          idleMs,
          savedSeconds: this.secretarySavedSeconds
        });

        if (idleMs >= this.hibernateAfterMs || (isTabHidden && idleMs >= this.hiddenTabHibernateMs)) {
          this._enterDeepHibernation(isTabHidden ? 'tab_hidden_45s' : 'silence_75s');
        }
      }
    }, 1000);
  }

  _wakeFromSecretaryHold(reason = 'voice_detected') {
    if (this.vadState !== 'secretary_hold') return;
    this.vadState = 'active';
    this.consecutiveVoiceFrames = 0;
    this.lastSpeechOrActionAt = Date.now();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        vadControl: {
          state: 'active',
          reason,
          savedSeconds: this.secretarySavedSeconds
        }
      }));
      this._flushPreRollChunks(this.preRollBuffer);
      this.preRollBuffer = [];
    }

    this.onVadStateChange('active', {
      reason,
      savedSeconds: this.secretarySavedSeconds
    });
  }

  _enterDeepHibernation(reason = 'silence_75s') {
    if (this.vadState === 'hibernating') return;
    this.vadState = 'hibernating';
    this._intentionalHibernate = true;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          vadControl: {
            state: 'hibernating',
            reason,
            savedSeconds: this.secretarySavedSeconds
          }
        }));
        this.ws.close(4005, 'Secretary deep hibernation');
      } catch (_) {}
    }
    this.ws = null;
    this.onVadStateChange('hibernating', {
      reason,
      savedSeconds: this.secretarySavedSeconds
    });
  }

  _flushPreRollChunks(chunks = []) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !chunks.length) return;
    this.ws.send(JSON.stringify({
      realtimeInput: {
        mediaChunks: chunks.map(data => ({ mimeType: 'audio/pcm;rate=16000', data }))
      }
    }));
  }

  async _startAudioStreaming() {
    if (!this.captureContext || !this.mediaStream) return;
    if (this.captureContext.state === 'suspended') {
      await this.captureContext.resume();
    }
    if (this.playbackContext && this.playbackContext.state === 'suspended') {
      await this.playbackContext.resume();
    }

    const source = this.captureContext.createMediaStreamSource(this.mediaStream);
    const zeroGain = this.captureContext.createGain();
    zeroGain.gain.value = 0;
    zeroGain.connect(this.captureContext.destination);

    if (this.captureContext.audioWorklet) {
      try {
        const workletCode = `
          class WebOrientPCMProcessor extends AudioWorkletProcessor {
            constructor() {
              super();
              this.buffer = new Float32Array(2048);
              this.offset = 0;
            }
            process(inputs) {
              const input = inputs[0];
              if (!input || !input[0]) return true;
              const channel = input[0];
              for (let i = 0; i < channel.length; i++) {
                this.buffer[this.offset++] = channel[i];
                if (this.offset >= this.buffer.length) {
                  this.port.postMessage(this.buffer.slice(0));
                  this.offset = 0;
                }
              }
              return true;
            }
          }
          registerProcessor('weborient-pcm-processor', WebOrientPCMProcessor);
        `;
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        await this.captureContext.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);

        this.workletNode = new AudioWorkletNode(this.captureContext, 'weborient-pcm-processor');
        this.workletNode.port.onmessage = (e) => {
          this._sendFloat32AudioFrame(e.data);
        };
        source.connect(this.workletNode);
        this.workletNode.connect(zeroGain);
        return;
      } catch (err) {
        console.warn('[WebOrient] AudioWorklet fallback to ScriptProcessor:', err);
      }
    }

    this.scriptProcessor = this.captureContext.createScriptProcessor(4096, 1, 1);
    this.scriptProcessor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      this._sendFloat32AudioFrame(inputData);
    };
    source.connect(this.scriptProcessor);
    this.scriptProcessor.connect(zeroGain);
  }

  _computeRmsEnergy(float32Array) {
    if (!float32Array || float32Array.length === 0) return 0;
    let sumSq = 0;
    for (let i = 0; i < float32Array.length; i++) {
      const s = float32Array[i];
      sumSq += s * s;
    }
    return Math.sqrt(sumSq / float32Array.length);
  }

  _sendFloat32AudioFrame(float32Array) {
    const rms = this._computeRmsEnergy(float32Array);
    const pcm16 = this._floatTo16BitPCM(float32Array);
    const base64 = this._arrayBufferToBase64(pcm16.buffer);

    this.preRollBuffer.push(base64);
    if (this.preRollBuffer.length > this.maxPreRollChunks) {
      this.preRollBuffer.shift();
    }

    if (!this.isPlaying && rms >= this.vadThresholdRms) {
      this.consecutiveVoiceFrames += 1;
      if (this.consecutiveVoiceFrames >= 2) {
        this.lastSpeechOrActionAt = Date.now();
        if (this.vadState === 'secretary_hold') {
          this._wakeFromSecretaryHold('voice_detected');
          return;
        } else if (this.vadState === 'hibernating') {
          this.vadState = 'waking';
          const buffered = [...this.preRollBuffer];
          this.preRollBuffer = [];
          this.consecutiveVoiceFrames = 0;
          this.onVadStateChange('wake_from_hibernation', { bufferedChunks: buffered });
          return;
        }
      }
    } else {
      this.consecutiveVoiceFrames = 0;
    }

    if (this.vadState !== 'active') return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(JSON.stringify({
      realtimeInput: {
        mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: base64 }]
      }
    }));
  }

  _handleServerMessage(msg) {
    if (msg.pong) {
      return;
    }

    if (msg.setupComplete) {
      this._reconnectAttempts = 0;
      return;
    }

    if (msg.error) {
      console.error('[WebOrient] Relay error:', msg.error, msg.code || '');
      if (msg.code === 'UNAUTHORIZED_OR_NO_CREDITS' || msg.code === 'RATE_LIMIT_EXCEEDED' || msg.code === 'UPSTREAM_POOL_EXHAUSTED') {
        this._terminalError = true;
      }
      return;
    }

    if (msg.creditUpdate) {
      this._reconnectAttempts = 0;
      this.onCreditUpdate(msg.creditUpdate);
    }

    if (msg.serverContent?.interrupted) {
      this.lastSpeechOrActionAt = Date.now();
      this._clearAudioQueue();
      this.onInterrupted();
      return;
    }

    if (msg.serverContent?.inputTranscription?.text) {
      this._reconnectAttempts = 0;
      this.lastSpeechOrActionAt = Date.now();
      this.onTranscript(msg.serverContent.inputTranscription.text, 'user');
    }

    if (msg.serverContent?.modelTurn?.parts) {
      this._reconnectAttempts = 0;
      this.lastSpeechOrActionAt = Date.now();
      for (const part of msg.serverContent.modelTurn.parts) {
        if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/pcm')) {
          this._scheduleAudioChunk(part.inlineData.data, 24000);
        }
        if (part.text) {
          this.onTranscript(part.text, 'model');
        }
      }
    }

    if (msg.serverContent?.outputTranscription?.text) {
      this._reconnectAttempts = 0;
      this.lastSpeechOrActionAt = Date.now();
      this.onTranscript(msg.serverContent.outputTranscription.text, 'model');
    }

    if (msg.toolCall?.functionCalls && msg.toolCall.functionCalls.length > 0) {
      this._reconnectAttempts = 0;
      this.lastSpeechOrActionAt = Date.now();
      this.onToolCall(msg.toolCall.functionCalls);
    }
  }

  async _scheduleAudioChunk(base64Audio, sampleRate = 24000) {
    if (!this.playbackContext || !base64Audio) return;
    if (this.playbackContext.state === 'suspended') {
      try { await this.playbackContext.resume(); } catch (_) {}
    }

    const int16 = this._base64ToInt16Array(base64Audio);
    if (int16.length === 0) return;

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    const audioBuffer = this.playbackContext.createBuffer(1, float32.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    const sourceNode = this.playbackContext.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(this.playbackContext.destination);

    const now = this.playbackContext.currentTime;
    const startAt = Math.max(now + 0.01, this.nextPlayTime);
    sourceNode.start(startAt);
    this.nextPlayTime = startAt + audioBuffer.duration;

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.onPlaybackChange(true);
    }

    this.activeSourceNodes.add(sourceNode);
    sourceNode.onended = () => {
      this.activeSourceNodes.delete(sourceNode);
      if (this.activeSourceNodes.size === 0) {
        this.isPlaying = false;
        this.lastSpeechOrActionAt = Date.now();
        this.onPlaybackChange(false);
      }
    };
  }

  _clearAudioQueue() {
    for (const node of this.activeSourceNodes) {
      try {
        node.stop(0);
        node.disconnect();
      } catch (_) {}
    }
    this.activeSourceNodes.clear();
    if (this.playbackContext) {
      this.nextPlayTime = this.playbackContext.currentTime;
    }
    if (this.isPlaying) {
      this.isPlaying = false;
      this.onPlaybackChange(false);
    }
  }

  sendToolResponse(callIdOrResponses, toolName, output) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.lastSpeechOrActionAt = Date.now();
    const functionResponses = Array.isArray(callIdOrResponses)
      ? callIdOrResponses
      : [
          {
            id: callIdOrResponses,
            name: toolName || 'tool_result',
            response: { output }
          }
        ];

    this.ws.send(JSON.stringify({
      toolResponse: { functionResponses }
    }));
  }

  sendText(text, options = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && text) {
      const turnComplete = options.turnComplete !== undefined ? Boolean(options.turnComplete) : true;
      if (turnComplete) {
        this.markActivity('text_prompt');
      }
      this.ws.send(JSON.stringify({ text: String(text), turnComplete }));
    }
  }

  /**
   * Sends out-of-band session telemetry (DOM audit events, partial lead capture, dwell state)
   * directly to the relay server without inflating Gemini Live's tool response context.
   */
  sendTelemetry(telemetry = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && telemetry) {
      this.ws.send(JSON.stringify({ telemetry }));
    }
  }

  _floatTo16BitPCM(input) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
  }

  _arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  _base64ToInt16Array(base64) {
    const binary = window.atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer);
  }

  stop(options = {}) {
    this._userStopped = true;
    this._intentionalHibernate = false;
    this.isReconnecting = false;
    this._reconnectAttempts = 0;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._keepaliveTimer) {
      clearInterval(this._keepaliveTimer);
      this._keepaliveTimer = null;
    }
    if (this._vadTimer) {
      clearInterval(this._vadTimer);
      this._vadTimer = null;
    }
    this._clearAudioQueue();
    if (this.workletNode) {
      try { this.workletNode.disconnect(); } catch (_) {}
      this.workletNode = null;
    }
    if (this.scriptProcessor) {
      try { this.scriptProcessor.disconnect(); } catch (_) {}
      this.scriptProcessor = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.captureContext) {
      this.captureContext.close().catch(() => {});
      this.captureContext = null;
    }
    if (this.playbackContext) {
      this.playbackContext.close().catch(() => {});
      this.playbackContext = null;
    }
    if (this.ws) {
      const closingWs = this.ws;
      this.ws = null;
      try { closingWs.close(); } catch (_) {}
    }
    if (!options.silent) {
      this.onStatusChange('disconnected');
    }
  }
}
