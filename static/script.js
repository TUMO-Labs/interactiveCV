const socket = io();

const chatToggle      = document.getElementById('chat-toggle');
const chatWindow      = document.getElementById('chat-window');
const closeChat       = document.getElementById('close-chat');
const regForm         = document.getElementById('registration-interface');
const chatInterface   = document.getElementById('chat-interface');
const startChatBtn    = document.getElementById('start-chat');
const visitorMsgBtn   = document.getElementById('visitor-msg');
const voiceBtn        = document.getElementById('voice-record-btn');
const micPulse        = document.getElementById('mic-pulse');
const chatInput       = document.getElementById('chat-input');
const visitorNameInput = document.getElementById('visitor-name');

let isChating    = false;
let isRecording  = false;
let mediaRecorder = null;
let audioChunks  = [];


// UI state
function setProcessing(on) {
    chatInput.disabled      = on;
    visitorMsgBtn.disabled  = on;
    voiceBtn.disabled       = on;
    chatInput.placeholder   = on ? 'Processing request...' : 'Type your message...';
}


// Voice recording
async function startVoiceRecording() {
    audioChunks = [];
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

            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            setProcessing(true);
            socket.emit('visitor_voice_message', audioBlob);
        };

        mediaRecorder.start();
        isRecording = true;
        micPulse.classList.remove('hidden');
        voiceBtn.className = 'bg-red-500 text-white p-2 rounded-lg hover:bg-red-600 transition shadow-sm relative group';

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

voiceBtn.addEventListener('click', () => {
    if (!isRecording) startVoiceRecording();
    else              stopVoiceRecording();
});


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

function addMessage(message, sender = 'visitor') {
    const messageContainer = document.getElementById('message-container');
    if (!messageContainer || !message || message.trim() === '') return;

    const isVisitor = sender === 'visitor';
    const row       = document.createElement('div');
    row.className   = `flex ${isVisitor ? 'justify-end' : 'justify-start'}`;

    if (!isVisitor) {
        const label       = document.createElement('div');
        label.className   = 'text-xs text-slate-400 mb-1 ml-1';
        label.textContent = sender === 'bot' ? '🤖 Bot' : '✏️ Arman';

        const col     = document.createElement('div');
        col.className = 'flex flex-col items-start max-w-[80%]';
        col.appendChild(label);

        const bubble            = document.createElement('div');
        bubble.className        = 'bg-white border border-slate-200 p-3 rounded-lg rounded-tl-none shadow-sm text-slate-700 w-full';
        bubble.style.whiteSpace = 'pre-wrap';
        bubble.textContent      = message.trim();
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


// Button listeners
chatToggle.addEventListener('click', toggleChat);
closeChat.addEventListener('click', toggleChat);
startChatBtn.addEventListener('click', startChat);
visitorMsgBtn.addEventListener('click', sendMessage);
visitorNameInput.addEventListener('keydown', startChatOnEnter);
chatInput.addEventListener('keydown', sendMessageOnEnter);


// Server events
socket.on('new_message', (data) => {
    addMessage(data.text, data.sender);
    setProcessing(false);
});


// Footer
window.addEventListener('load', () => {
    const span = document.getElementById('footer-info');
    if (span) span.innerText = `© ${new Date().getFullYear()} Arman Arakelyan`;

    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
});