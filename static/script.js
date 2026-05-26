const socket = io();

const chatToggle      = document.getElementById('chat-toggle');
const chatWindow      = document.getElementById('chat-window');
const closeChat       = document.getElementById('close-chat');
const regForm         = document.getElementById('registration-interface');
const chatInterface   = document.getElementById('chat-interface');
const startChatBtn    = document.getElementById('start-chat');
const visitorMsgBtn   = document.getElementById('visitor-msg');
const voiceBtn        = document.getElementById('voice-record-btn');
const voiceCancelBtn  = document.getElementById('voice-cancel-btn');
const micPulse        = document.getElementById('mic-pulse');
const chatInput       = document.getElementById('chat-input');
const visitorNameInput = document.getElementById('visitor-name');

let isChating    = false;
let isRecording  = false;
let mediaRecorder = null;
let audioChunks  = [];
let currentAudio = null;
let currentAudioMessageId = null;
let currentAudioButton = null;
let speechRecognition = null;
let finalTranscript = '';


// UI state
function setProcessing(on) {
    chatInput.disabled      = on;
    visitorMsgBtn.disabled  = on;
    voiceBtn.disabled       = on;
    chatInput.placeholder   = on ? 'Processing request...' : 'Type your message...';
}

function initSpeechRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return null;

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            if (result.isFinal) finalTranscript += result[0].transcript;
            else interim += result[0].transcript;
        }
        chatInput.value = `${finalTranscript}${interim}`.trim();
    };

    recognition.onend = () => {
        if (isRecording) {
            try { recognition.start(); } catch (_) {}
        }
    };

    recognition.onerror = (e) => {
        console.warn('[Speech] recognition error:', e);
    };

    return recognition;
}


// Voice recording
async function startVoiceRecording() {
    audioChunks = [];
    finalTranscript = '';
    chatInput.value = '';
    try {
        const stream  = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            micPulse.classList.add('hidden');
            voiceBtn.className = 'bg-slate-100 text-slate-600 p-2 rounded-lg hover:bg-slate-200 transition shadow-sm relative group';
            voiceCancelBtn.classList.add('hidden');

            if (speechRecognition) {
                try { speechRecognition.stop(); } catch (_) {}
            }

            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            setProcessing(true);
            socket.emit('visitor_voice_message', audioBlob);
        };

        mediaRecorder.start();
        isRecording = true;
        micPulse.classList.remove('hidden');
        voiceBtn.className = 'bg-red-500 text-white p-2 rounded-lg hover:bg-red-600 transition shadow-sm relative group';
        voiceCancelBtn.classList.remove('hidden');

        speechRecognition = speechRecognition || initSpeechRecognition();
        if (speechRecognition) {
            try { speechRecognition.start(); } catch (_) {}
        } else {
            console.warn('[Speech] Recognition API not supported in this browser');
        }

    } catch (err) {
        console.error('Microphone access denied:', err);
        alert('Microphone access error. Please check your browser permissions.');
    }
}

function stopVoiceRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
    }
}

function cancelVoiceRecording() {
    if (!isRecording) return;
    isRecording = false;
    audioChunks = [];
    finalTranscript = '';
    chatInput.value = '';

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.onstop = null;
        try { mediaRecorder.stop(); } catch (_) {}
    }

    if (speechRecognition) {
        try { speechRecognition.stop(); } catch (_) {}
    }

    micPulse.classList.add('hidden');
    voiceBtn.className = 'bg-slate-100 text-slate-600 p-2 rounded-lg hover:bg-slate-200 transition shadow-sm relative group';
    voiceCancelBtn.classList.add('hidden');
}

voiceBtn.addEventListener('click', () => {
    if (!isRecording) startVoiceRecording();
    else              stopVoiceRecording();
});

voiceCancelBtn.addEventListener('click', cancelVoiceRecording);


// Chat interface
function showChatInterface(name) {
    regForm.classList.add('hidden');
    chatInterface.classList.remove('hidden');
    document.getElementById('display-name').innerText = name;
}

function startChat() {
    const name = visitorNameInput.value.trim();
    if (name === '') return;

    visitorNameInput.value = '';
    socket.emit('register_visitor', { name });
    showChatInterface(name);
    chatInput.focus();
    isChating = true;
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

        let audioBtn = null;
        if (sender === 'bot') {
            audioBtn = document.createElement('button');
            audioBtn.className = 'text-xs bg-slate-100 border border-slate-200 text-slate-600 px-2 py-1 rounded-md hover:bg-slate-200 transition shrink-0';
            audioBtn.textContent = audioUrl ? 'Stop' : 'No audio';
            audioBtn.dataset.audioUrl = audioUrl;
            audioBtn.dataset.messageId = messageId;
            if (!audioUrl) audioBtn.disabled = true;

            if (audioUrl) {
                audioBtn.addEventListener('click', () => {
                    toggleAudioPlayback(audioBtn.dataset.audioUrl, audioBtn.dataset.messageId, audioBtn);
                });
            }

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

    if (sender === 'bot') {
        return { messageId, audioButton: audioButtonRef };
    }
    return null;
}

function playBotAudio(url, messageId = null, button = null) {
    if (!url) return;
    console.log('[TTS] Attempting playback:', url);
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
    }
    if (currentAudioButton && currentAudioButton !== button) {
        currentAudioButton.textContent = 'Play';
    }

    currentAudio = new Audio(url);
    currentAudioMessageId = messageId;
    currentAudioButton = button || null;
    if (button) button.textContent = 'Stop';
    currentAudio.onended = () => {
        if (button) button.textContent = 'Play';
    };
    currentAudio.play().catch((err) => {
        console.warn('Audio playback failed:', err);
    });
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
    if (message === '') return;

    chatInput.value = '';
    socket.emit('visitor_message', { message });
    addMessage(message, 'visitor');
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


// Enter key shortcuts
function startChatOnEnter(event) {
    if (event.key === 'Enter') { event.preventDefault(); startChat(); }
}

function sendMessageOnEnter(event) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
}

function cancelOnEscape(event) {
    if (event.key === 'Escape') cancelVoiceRecording();
}


// Button listeners
chatToggle.addEventListener('click', toggleChat);
closeChat.addEventListener('click', toggleChat);
startChatBtn.addEventListener('click', startChat);
visitorMsgBtn.addEventListener('click', sendMessage);
visitorNameInput.addEventListener('keydown', startChatOnEnter);
chatInput.addEventListener('keydown', sendMessageOnEnter);
window.addEventListener('keydown', cancelOnEscape);


// Server events
socket.on('new_message', (data) => {
    console.log('[Socket] new_message:', data);
    const messageInfo = addMessage(data.text, data.sender, data.audio_url || null);
    if (data.sender === 'bot' && data.audio_url && messageInfo) {
        playBotAudio(data.audio_url, messageInfo.messageId, messageInfo.audioButton);
    }
    setProcessing(false);
});


// Footer
window.addEventListener('load', () => {
    const span = document.getElementById('footer-info');
    if (span) span.innerText = `© ${new Date().getFullYear()} Arman Arakelyan`;

    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
});