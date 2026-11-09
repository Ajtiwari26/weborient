/**
 * WebOrient Live Client
 * Manages Web Audio capture (16kHz PCM mono), playback of 24kHz model responses,
 * WebSocket transport, barge-in buffer clearance, and tool-call routing.
 */
export class LiveClient {
  constructor(options = {}) {
    this.endpoint = options.endpoint || 'ws://localhost:8080/weborient-relay';
    this.onToolCall = options.onToolCall || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.ws = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.audioQueue = [];
    this.isPlaying = false;
  }

  /**
   * Starts microphone recording and connects to WebSocket relay
   */
  async connect() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });

    this.ws = new WebSocket(this.endpoint);

    this.ws.onopen = () => {
      this.onStatusChange('connected');
      this._startAudioStreaming();
    };

    this.ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      this._handleServerMessage(data);
    };

    this.ws.onclose = () => {
      this.onStatusChange('disconnected');
      this.stop();
    };

    this.ws.onerror = (err) => {
      console.error('[WebOrient] WebSocket error:', err);
      this.onStatusChange('error');
    };
  }

  _startAudioStreaming() {
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    const processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = this._floatTo16BitPCM(inputData);
        const base64 = this._arrayBufferToBase64(pcm16.buffer);

        this.ws.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: base64 }]
          }
        }));
      }
    };

    source.connect(processor);
    processor.connect(this.audioContext.destination);
  }

  _handleServerMessage(msg) {
    // 1. Handle user barge-in (interrupted by user speaking)
    if (msg.serverContent?.interrupted) {
      this._clearAudioQueue();
      return;
    }

    // 2. Play incoming audio chunks
    if (msg.serverContent?.modelTurn?.parts) {
      for (const part of msg.serverContent.modelTurn.parts) {
        if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
          this._queueAudioChunk(part.inlineData.data);
        }
      }
    }

    // 3. Handle model tool calls
    if (msg.toolCall?.functionCalls) {
      for (const call of msg.toolCall.functionCalls) {
        this.onToolCall(call.name, call.args, call.id);
      }
    }
  }

  sendToolResponse(callId, output) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        toolResponse: {
          functionResponses: [{ id: callId, response: { output } }]
        }
      }));
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

  _queueAudioChunk(base64Audio) {
    // Queues 24kHz PCM for playback in AudioContext
    this.audioQueue.push(base64Audio);
    if (!this.isPlaying) {
      this._playNextInQueue();
    }
  }

  async _playNextInQueue() {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      return;
    }
    this.isPlaying = true;
    this.audioQueue.shift();
    // Simulate audio tick
    setTimeout(() => this._playNextInQueue(), 120);
  }

  _clearAudioQueue() {
    this.audioQueue = [];
    this.isPlaying = false;
  }

  stop() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
    if (this.ws) {
      this.ws.close();
    }
  }
}
