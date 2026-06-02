// =============================================================================
//  script.js  –  Interactive CV chat widget
//  New in this version: Gemini Live API (direct browser WebSocket) for real-
//  time voice.  Legacy text path is fully preserved as the fallback.
// =============================================================================

const socket = io();

const chatToggle       = document.getElementById('chat-toggle');
const chatWindow       = document.getElementById('chat-window');
const closeChat        = document.getElementById('close-chat');
const regForm          = document.getElementById('registration-interface');
const chatInterface    = document.getElementById('chat-interface');
const startChatBtn     = document.getElementById('start-chat');
const visitorMsgBtn    = document.getElementById('visitor-msg');
const voiceBtn         = document.getElementById('voice-record-btn');
const voiceCancelBtn   = document.getElementById('voice-cancel-btn');
const micPulse         = document.getElementById('mic-pulse');
const chatInput        = document.getElementById('chat-input');
const visitorNameInput = document.getElementById('visitor-name');

let isChating    = false;
let currentAudio = null;
let currentAudioMessageId = null;
let currentAudioButton    = null;

// =============================================================================
//  UI helpers
// =============================================================================

function setProcessing(on) {
    chatInput.disabled     = on;
    visitorMsgBtn.disabled = on;
    voiceBtn.disabled      = on;
    chatInput.placeholder  = on ? 'Processing request…' : 'Type your message…';
}

// =============================================================================
//  GeminiLiveSession
//  Opens a WebSocket directly from the browser to the Gemini Live API using an
//  ephemeral token provisioned by our server.  Handles:
//    • mic capture → 16 kHz PCM chunks → base64 → WS
//    • incoming PCM audio chunks → AudioContext queue → gapless playback
//    • trigger_fallback tool call → Socket.IO `live_fallback`
//    • WS errors / rate-limits → Socket.IO `live_error`
// =============================================================================

class GeminiLiveSession {
    constructor() {
        this._ws           = null;
        this._audioCtx     = null;
        this._audioQueue   = [];       // ArrayBuffers of raw PCM waiting to play
        this._isPlaying    = false;
        this._nextPlayTime = 0;

        // Mic capture
        this._micStream    = null;
        this._scriptNode   = null;
        this._sourceNode   = null;
        this._captureCtx   = null;     // separate AudioContext at 16 kHz

        // State
        this._wsUrl        = null;
        this._connected    = false;
        this._sessionSid   = null;     // socket.id at connection time
        this._lastUserText = '';       // best-effort transcript for fallback reporting
    }

    // -------------------------------------------------------------------------
    //  Public API
    // -------------------------------------------------------------------------

    /** Fetch a token from our server and open the WS. */
    async connect(socketSid) {
        this._sessionSid = socketSid;
        try {
            const res  = await fetch('/api/live-token', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ sid: socketSid }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                console.error('[Live] token error:', data.error || res.status);
                return false;
            }
            this._wsUrl = data.ws_url;
        } catch (e) {
            console.error('[Live] fetch token failed:', e);
            return false;
        }

        return this._openWebSocket();
    }

    /** Send a plain-text message over the Live session. */
    sendText(text) {
        if (!this._connected) return false;
        this._lastUserText = text;
        this._wsSend({ realtimeInput: { text } });
        return true;
    }

    /** Start streaming mic audio. */
    async startMic() {
        if (!this._connected) return false;
        try {
            this._micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            console.error('[Live] mic access denied:', e);
            return false;
        }
        await this._startPcmCapture();
        return true;
    }

    /** Stop streaming mic audio (does not close the WS). */
    stopMic() {
        this._stopPcmCapture();
    }

    /** Cleanly close everything. */
    close() {
        this._stopPcmCapture();
        if (this._ws) {
            try { this._ws.close(); } catch (_) {}
            this._ws = null;
        }
        this._connected = false;
        if (this._audioCtx) {
            try { this._audioCtx.close(); } catch (_) {}
            this._audioCtx = null;
        }
    }

    // -------------------------------------------------------------------------
    //  WebSocket management
    // -------------------------------------------------------------------------

    _openWebSocket() {
        return new Promise((resolve) => {
            const ws = new WebSocket(this._wsUrl);
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                console.log('[Live] WS open — sending config');
                // NOTE: because we used liveConnectConstraints when minting the
                // token, the model / system instructions / tools are already
                // locked in.  We still must send a setup-style config frame to
                // satisfy the protocol; we keep it minimal.
                ws.send(JSON.stringify({
                    setup: {
                        // model is already locked by the token — sending it
                        // again is harmless and required by the raw WS protocol.
                        model: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
                    }
                }));
                this._ws        = ws;
                this._connected = true;
                resolve(true);
            };

            ws.onmessage = (evt) => this._onMessage(evt);

            ws.onerror = (evt) => {
                console.error('[Live] WS error', evt);
                this._connected = false;
                socket.emit('live_error', { type: 'error', message: 'WebSocket error' });
                resolve(false);
            };

            ws.onclose = (evt) => {
                console.warn('[Live] WS closed', evt.code, evt.reason);
                this._connected = false;
                // 1013 = rate-limited by Gemini
                if (evt.code === 1013 || (evt.reason && evt.reason.toLowerCase().includes('quota'))) {
                    socket.emit('live_error', { type: 'rate_limited', message: evt.reason });
                }
            };

            // Timeout if the WS never opens
            setTimeout(() => {
                if (!this._connected) {
                    console.error('[Live] WS open timeout');
                    try { ws.close(); } catch (_) {}
                    resolve(false);
                }
            }, 8000);
        });
    }

    _wsSend(obj) {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify(obj));
        }
    }

    // -------------------------------------------------------------------------
    //  Incoming message handler
    // -------------------------------------------------------------------------

    _onMessage(evt) {
        let msg;
        try {
            msg = JSON.parse(typeof evt.data === 'string' ? evt.data : new TextDecoder().decode(evt.data));
        } catch (e) {
            console.warn('[Live] non-JSON message', e);
            return;
        }

        // --- Audio output chunks ---
        const parts = msg?.serverContent?.modelTurn?.parts;
        if (parts) {
            for (const part of parts) {
                if (part?.inlineData?.data) {
                    this._enqueueAudio(part.inlineData.data);
                }
                // Text transcription of the model's spoken output
                if (part?.text) {
                    const trimmed = part.text.trim();
                    if (trimmed) {
                        addMessage(trimmed, 'bot');
                    }
                }
            }
        }

        // --- Input transcript (what the user said) ---
        const inputTx = msg?.serverContent?.inputTranscription?.text;
        if (inputTx && inputTx.trim()) {
            this._lastUserText = inputTx.trim();
            addMessage(inputTx.trim(), 'visitor');
        }

        // --- Tool call: trigger_fallback ---
        const toolCall = msg?.toolCall;
        if (toolCall?.functionCalls) {
            for (const fc of toolCall.functionCalls) {
                if (fc.name === 'trigger_fallback') {
                    // Acknowledge the tool call so the WS stays healthy
                    this._wsSend({
                        toolResponse: {
                            functionResponses: [{
                                name:     fc.name,
                                id:       fc.id,
                                response: { result: 'ok' },
                            }]
                        }
                    });
                    // Route to human via our server
                    socket.emit('live_fallback', { message: this._lastUserText });
                }
            }
        }

        // --- Rate-limit sentinel in text ---
        const textContent = msg?.serverContent?.modelTurn?.parts?.find(p => p.text)?.text || '';
        if (textContent.includes('__RATE_LIMITED__')) {
            socket.emit('live_error', { type: 'rate_limited', message: 'Rate limit token in response' });
        }
        if (textContent.includes('__ERRORED__')) {
            socket.emit('live_error', { type: 'error', message: 'Error token in response' });
        }
    }

    // -------------------------------------------------------------------------
    //  PCM mic capture  (16 kHz, mono, little-endian 16-bit)
    //
    //  We create a separate AudioContext forced to 16 kHz.  A ScriptProcessor
    //  (deprecated but universally supported without a separate Worker) converts
    //  float32 samples to Int16 and sends them in ~100 ms chunks.
    // -------------------------------------------------------------------------

    async _startPcmCapture() {
        // 16 kHz is required by the Live API for audio input
        this._captureCtx = new AudioContext({ sampleRate: 16000 });
        await this._captureCtx.resume();

        this._sourceNode = this._captureCtx.createMediaStreamSource(this._micStream);

        // bufferSize 4096 @ 16 kHz ≈ 256 ms per chunk  (acceptable latency)
        this._scriptNode = this._captureCtx.createScriptProcessor(4096, 1, 1);
        this._scriptNode.onaudioprocess = (e) => {
            const float32 = e.inputBuffer.getChannelData(0);
            const int16   = this._float32ToInt16(float32);
            const b64     = this._arrayBufferToBase64(int16.buffer);
            this._wsSend({
                realtimeInput: {
                    audio: { data: b64, mimeType: 'audio/pcm;rate=16000' }
                }
            });
        };

        this._sourceNode.connect(this._scriptNode);
        this._scriptNode.connect(this._captureCtx.destination);
        console.log('[Live] mic capture started');
    }

    _stopPcmCapture() {
        if (this._scriptNode) {
            try { this._scriptNode.disconnect(); } catch (_) {}
            this._scriptNode = null;
        }
        if (this._sourceNode) {
            try { this._sourceNode.disconnect(); } catch (_) {}
            this._sourceNode = null;
        }
        if (this._captureCtx) {
            try { this._captureCtx.close(); } catch (_) {}
            this._captureCtx = null;
        }
        if (this._micStream) {
            this._micStream.getTracks().forEach(t => t.stop());
            this._micStream = null;
        }
        console.log('[Live] mic capture stopped');
    }

    _float32ToInt16(float32Array) {
        const int16 = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s  = Math.max(-1, Math.min(1, float32Array[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16;
    }

    _arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    // -------------------------------------------------------------------------
    //  Audio output queue  (gapless PCM playback via AudioContext)
    //
    //  The Live API returns raw 24 kHz 16-bit PCM (little-endian mono).
    //  We decode each base64 chunk to Int16, convert to float32, schedule an
    //  AudioBufferSourceNode to play back-to-back so there are no gaps.
    // -------------------------------------------------------------------------

    _getAudioCtx() {
        if (!this._audioCtx || this._audioCtx.state === 'closed') {
            this._audioCtx     = new AudioContext({ sampleRate: 24000 });
            this._nextPlayTime = 0;
        }
        return this._audioCtx;
    }

    _enqueueAudio(base64String) {
        const ctx    = this._getAudioCtx();
        const bytes  = Uint8Array.from(atob(base64String), c => c.charCodeAt(0));
        const int16  = new Int16Array(bytes.buffer);
        const float  = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
            float[i] = int16[i] / 32768.0;
        }

        const audioBuffer = ctx.createBuffer(1, float.length, 24000);
        audioBuffer.copyToChannel(float, 0);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const now = ctx.currentTime;
        if (this._nextPlayTime < now) this._nextPlayTime = now;

        source.start(this._nextPlayTime);
        this._nextPlayTime += audioBuffer.duration;
    }
}

// Singleton session — one per visitor
let liveSession = null;

// =============================================================================
//  Voice recording (Live API path)
// =============================================================================

let isRecording = false;

async function startVoiceRecording() {
    if (!liveSession) {
        console.warn('[Live] no session yet — cannot record');
        return;
    }
    const ok = await liveSession.startMic();
    if (!ok) {
        alert('Microphone access error. Please check your browser permissions.');
        return;
    }
    isRecording = true;
    micPulse.classList.remove('hidden');
    voiceBtn.className = 'bg-red-500 text-white p-2 rounded-lg hover:bg-red-600 transition shadow-sm relative group';
    voiceCancelBtn.classList.remove('hidden');
}

function stopVoiceRecording() {
    if (!isRecording) return;
    isRecording = false;
    if (liveSession) liveSession.stopMic();
    micPulse.classList.add('hidden');
    voiceBtn.className = 'bg-slate-100 border border-slate-200 text-slate-600 p-2 rounded-lg hover:bg-slate-200 hover:text-slate-800 transition shadow-sm relative group';
    voiceCancelBtn.classList.add('hidden');
}

function cancelVoiceRecording() {
    stopVoiceRecording();
}

voiceBtn.addEventListener('click', () => {
    if (!isRecording) startVoiceRecording();
    else              stopVoiceRecording();
});
voiceCancelBtn.addEventListener('click', cancelVoiceRecording);

// =============================================================================
//  Chat interface
// =============================================================================

function showChatInterface(name) {
    regForm.classList.add('hidden');
    chatInterface.classList.remove('hidden');
    document.getElementById('display-name').innerText = name;
}

async function startChat() {
    const name = visitorNameInput.value.trim();
    if (!name) return;

    visitorNameInput.value = '';
    socket.emit('register_visitor', { name });
    showChatInterface(name);
    chatInput.focus();
    isChating = true;

    // Initialise the Live session in the background
    liveSession = new GeminiLiveSession();
    const ok    = await liveSession.connect(socket.id);
    if (ok) {
        console.log('[Live] session ready');
    } else {
        console.warn('[Live] session failed — falling back to text-only mode');
        liveSession = null;
    }
}

function addMessage(message, sender = 'visitor', audioUrl = null) {
    const messageContainer = document.getElementById('message-container');
    if (!messageContainer || !message || message.trim() === '') return;

    const isVisitor = sender === 'visitor';
    const row       = document.createElement('div');
    row.className   = `flex ${isVisitor ? 'justify-end' : 'justify-start'}`;

    const messageId = `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    let audioButtonRef = null;

    if (!isVisitor) {
        const label       = document.createElement('div');
        label.className   = 'text-xs text-slate-400 mb-1 ml-1';
        label.textContent = sender === 'bot' ? '🤖 Bot' : '✏️ Arman';

        const col     = document.createElement('div');
        col.className = 'flex flex-col items-start max-w-[80%]';
        col.appendChild(label);

        const bubble = document.createElement('div');
        bubble.className = 'bg-white border border-slate-200 p-3 rounded-lg rounded-tl-none shadow-sm text-slate-700 w-full flex items-start justify-between gap-3';

        const content = document.createElement('div');
        content.style.whiteSpace = 'pre-wrap';
        content.textContent = message.trim();
        bubble.appendChild(content);

        // Audio play button — only for legacy TTS bot messages
        if (sender === 'bot' && audioUrl) {
            const audioBtn = document.createElement('button');
            audioBtn.className = 'text-xs bg-slate-100 border border-slate-200 text-slate-600 px-2 py-1 rounded-md hover:bg-slate-200 transition shrink-0';
            audioBtn.textContent = 'Play';
            audioBtn.dataset.audioUrl   = audioUrl;
            audioBtn.dataset.messageId  = messageId;
            audioBtn.addEventListener('click', () => {
                toggleAudioPlayback(audioBtn.dataset.audioUrl, audioBtn.dataset.messageId, audioBtn);
            });
            bubble.appendChild(audioBtn);
            audioButtonRef = audioBtn;
        }

        col.appendChild(bubble);
        row.appendChild(col);
    } else {
        const bubble            = document.createElement('div');
        bubble.className        = 'max-w-[80%] bg-sky-600 border border-sky-700 p-3 rounded-lg rounded-tr-none shadow-sm text-white';
        bubble.style.whiteSpace = 'pre-wrap';
        bubble.textContent      = message.trim();
        row.appendChild(bubble);
    }

    messageContainer.appendChild(row);
    messageContainer.scrollTop = messageContainer.scrollHeight;

    if (sender === 'bot') return { messageId, audioButton: audioButtonRef };
    return null;
}

// Legacy TTS file playback (only used when ENABLE_TTS=true on REST path)
function playBotAudio(url, messageId = null, button = null) {
    if (!url) return;
    if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }
    if (currentAudioButton && currentAudioButton !== button) {
        currentAudioButton.textContent = 'Play';
    }
    currentAudio          = new Audio(url);
    currentAudioMessageId = messageId;
    currentAudioButton    = button;
    if (button) button.textContent = 'Stop';
    currentAudio.onended  = () => { if (button) button.textContent = 'Play'; };
    currentAudio.play().catch(e => console.warn('[TTS] playback failed:', e));
}

function toggleAudioPlayback(url, messageId, button) {
    if (!url) return;
    const isSame = currentAudio && currentAudioMessageId === messageId;
    if (isSame && !currentAudio.paused) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        if (button) button.textContent = 'Play';
        return;
    }
    playBotAudio(url, messageId, button);
}

function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;
    chatInput.value = '';
    addMessage(message, 'visitor');

    // Try the Live session first; fall back to the legacy REST path
    if (liveSession && liveSession.sendText(message)) {
        console.log('[Live] text sent via Live API');
        return;
    }

    // Legacy fallback
    socket.emit('visitor_message', { message });
    setProcessing(true);
}

function toggleChat() {
    if (chatWindow.classList.contains('hidden')) {
        chatWindow.classList.remove('hidden');
        setTimeout(() => {
            chatWindow.classList.remove('scale-95', 'opacity-0');
            chatWindow.classList.add('scale-100', 'opacity-100');
            if (isChating) chatInput.focus();
            else           visitorNameInput.focus();
        }, 10);
    } else {
        chatWindow.classList.remove('scale-100', 'opacity-100');
        chatWindow.classList.add('scale-95', 'opacity-0');
        setTimeout(() => chatWindow.classList.add('hidden'), 300);
    }
}

// =============================================================================
//  Enter / Escape shortcuts
// =============================================================================

function startChatOnEnter(event) {
    if (event.key === 'Enter') { event.preventDefault(); startChat(); }
}
function sendMessageOnEnter(event) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
}
function cancelOnEscape(event) {
    if (event.key === 'Escape') cancelVoiceRecording();
}

// =============================================================================
//  Button listeners
// =============================================================================

chatToggle.addEventListener('click', toggleChat);
closeChat.addEventListener('click', toggleChat);
startChatBtn.addEventListener('click', startChat);
visitorMsgBtn.addEventListener('click', sendMessage);
visitorNameInput.addEventListener('keydown', startChatOnEnter);
chatInput.addEventListener('keydown', sendMessageOnEnter);
window.addEventListener('keydown', cancelOnEscape);

// =============================================================================
//  Server → client Socket.IO events
// =============================================================================

// new_message — used by: legacy REST replies, Telegram operator replies
socket.on('new_message', (data) => {
    console.log('[Socket] new_message:', data);
    const messageInfo = addMessage(data.text, data.sender, data.audio_url || null);
    if (data.sender === 'bot' && data.audio_url && messageInfo) {
        playBotAudio(data.audio_url, messageInfo.messageId, messageInfo.audioButton);
    }
    setProcessing(false);
});

// error
socket.on('error', (data) => {
    console.error('[Socket] error:', data);
    setProcessing(false);
});

// =============================================================================
//  Footer
// =============================================================================

window.addEventListener('load', () => {
    const span = document.getElementById('footer-info');
    if (span) span.innerText = `© ${new Date().getFullYear()} Arman Arakelyan`;
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
});