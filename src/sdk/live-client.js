/**
 * WebOrient Live Client (v0.4.0)
 * - Captures 16kHz mono PCM microphone audio (AudioWorklet with ScriptProcessor fallback)
 * - Decodes and plays 24kHz Int16 PCM model audio streams gaplessly via Web Audio API
 * - Instant barge-in cancellation (<50ms) stopping all active AudioBufferSourceNodes
 * - Forwards both User (`inputTranscription`) and Model (`outputTranscription`) speech transcripts
 *   so WebOrient can auto-highlight described DOM elements in real time and lock user language!
 */
export class LiveClient {
  constructor(options = {}) {
    this.endpoint = options.endpoint || 'ws://localhost:8088';
    this.onToolCall = options.onToolCall || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onPlaybackChange = options.onPlaybackChange || (() => {});
    this.onInterrupted = options.onInterrupted || (() => {});

    this.ws = null;
    this.captureContext = null;
    this.playbackContext = null;
    this.mediaStream = null;
    this.workletNode = null;
    this.scriptProcessor = null;

    this.activeSourceNodes = new Set();
    this.nextPlayTime = 0;
    this.isPlaying = false;
  }

  async connect() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.captureContext = new AudioCtx({ sampleRate: 16000 });
    this.playbackContext = new AudioCtx({ sampleRate: 24000 });

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      this.ws = new WebSocket(this.endpoint);

      this.ws.onopen = async () => {
        settled = true;
        this.onStatusChange('connected');
        await this._startAudioStreaming();
        resolve();
      };

      this.ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleServerMessage(data);
        } catch (err) {
          console.error('[WebOrient] Failed to parse server frame:', err);
        }
      };

      this.ws.onclose = () => {
        this.onStatusChange('disconnected');
        this.stop();
      };

      this.ws.onerror = (err) => {
        console.error('[WebOrient] WebSocket error:', err);
        this.onStatusChange('error');
        if (!settled) {
          settled = true;
          reject(new Error(`WebSocket connection failed to ${this.endpoint}`));
        }
      };
    });
  }

  async _startAudioStreaming() {
    if (!this.captureContext || !this.mediaStream) return;
    if (this.captureContext.state === 'suspended') {
      await this.captureContext.resume();
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

  _sendFloat32AudioFrame(float32Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const pcm16 = this._floatTo16BitPCM(float32Array);
    const base64 = this._arrayBufferToBase64(pcm16.buffer);

    this.ws.send(JSON.stringify({
      realtimeInput: {
        mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: base64 }]
      }
    }));
  }

  _handleServerMessage(msg) {
    // 1. Handle user barge-in interruption
    if (msg.serverContent?.interrupted) {
      this._clearAudioQueue();
      this.onInterrupted();
      return;
    }

    // 2. Forward user speech transcription (`inputTranscription`) for language detection & memory
    if (msg.serverContent?.inputTranscription?.text) {
      this.onTranscript(msg.serverContent.inputTranscription.text, 'user');
    }

    // 3. Play incoming 24kHz PCM audio chunks & forward model transcripts
    if (msg.serverContent?.modelTurn?.parts) {
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
      this.onTranscript(msg.serverContent.outputTranscription.text, 'model');
    }

    // 4. Handle model tool calls
    if (msg.toolCall?.functionCalls) {
      for (const call of msg.toolCall.functionCalls) {
        this.onToolCall(call.name, call.args || {}, call.id);
      }
    }
  }

  async _scheduleAudioChunk(base64Audio, sampleRate = 24000) {
    if (!this.playbackContext || !base64Audio) return;
    if (this.playbackContext.state === 'suspended') {
      await this.playbackContext.resume();
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

  sendToolResponse(callId, toolName, output) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        toolResponse: {
          functionResponses: [
            {
              id: callId,
              name: toolName || 'tool_result',
              response: { output }
            }
          ]
        }
      }));
    }
  }

  sendText(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && text) {
      this.ws.send(JSON.stringify({ text: String(text) }));
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

  stop() {
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
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
  }
}
