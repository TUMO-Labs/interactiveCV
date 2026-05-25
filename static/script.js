const socket = io();
 
const chatToggle = document.getElementById('chat-toggle');
const chatWindow = document.getElementById('chat-window');
const closeChat = document.getElementById('close-chat');
const regForm = document.getElementById('registration-interface');
const chatInterface = document.getElementById('chat-interface');
const startChatBtn = document.getElementById('start-chat');
const visitorMsgBtn = document.getElementById('visitor-msg');
const voiceBtn = document.getElementById('voice-record-btn');
const micIcon = document.getElementById('mic-icon');
const micPulse = document.getElementById('mic-pulse');
const chatInput = document.getElementById('chat-input');
const visitorNameInput = document.getElementById('visitor-name');

let isChating = false;
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

// TEXT-TO-SPEECH (SPEAK BACK) ENGINE
function speakText(text) {
    if (!('speechSynthesis' in window)) {
        console.warn('Text-to-speech not supported in this browser.');
        return;
    }

    // Cancel any speech currently playing to avoid overlapping audio
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    // Optional configuration properties
    utterance.rate = 1.0;  // Speed (0.1 to 10)
    utterance.pitch = 1.0; // Pitch (0 to 2)

    // Attempt auto-detection of text language for natural pronunciation accents
    // Default to 'en-US' if text character analysis is simple or fails
    utterance.lang = 'en-US'; 
    
    // Quick validation regex checking for Cyrillic/Armenian alphabet blocks
    if (/[\u0530-\u058F]/.test(text)) utterance.lang = 'hy-AM'; // Armenian
    else if (/[\u0400-\u04FF]/.test(text)) utterance.lang = 'ru-RU'; // Russian

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
        // Look for native matching voice lines locally saved on operating systems
        const preferredVoice = voices.find(voice => 
            voice.lang.startsWith(utterance.lang.split('-')[0])
        );
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }
    }

    window.speechSynthesis.speak(utterance);
}


// MULTILINGUAL SPEECH-TO-TEXT (MEDIA RECORDER)
async function startVoiceRecording() {
    audioChunks = [];
    try {
        // Request browser microphone hardware authorization access
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            // Package the audio chunks as a standard webm audio file payload
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            
            // Turn off the active microphone hardware system indicator light
            stream.getTracks().forEach(track => track.stop());

            // Reset UI record buttons back to default slate values
            micPulse.classList.add('hidden');
            voiceBtn.className = "bg-slate-100 text-slate-600 p-2 rounded-lg hover:bg-slate-200 transition shadow-sm relative group";
            
            // Transmit the binary audio stream over SocketIO to the Flask server
            socket.emit('visitor_voice_message', audioBlob);
        };

        // If bot is currently speaking, silence it immediately before user talks
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();

        mediaRecorder.start();
        isRecording = true;

        // Visual UI record states activation triggers
        micPulse.classList.remove('hidden');
        voiceBtn.className = "bg-red-500 text-white p-2 rounded-lg hover:bg-red-600 transition shadow-sm relative group";

    } catch (err) {
        console.error("Microphone hardware block initialization exception:", err);
        alert("Microphone connection access error. Please inspect dashboard site permissions configuration.");
    }
}

function stopVoiceRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
    }
}

if (voiceBtn) {
    voiceBtn.addEventListener('click', () => {
        if (!isRecording) {
            startVoiceRecording();
        } else {
            stopVoiceRecording();
        }
    });
}


// Show chat interface after registration
function showChatInterface(name) {
    regForm.classList.add('hidden');
    chatInterface.classList.remove('hidden');
    document.getElementById('display-name').innerText = name;
}

// Register visitor and switch to chat view
function startChat() {
    const name = visitorNameInput.value.trim();
 
    if (name === '')
        return;
 
    visitorNameInput.value = '';
 
    socket.emit('register_visitor', { name });
    showChatInterface(name);
    chatInput.focus();
    isChating = true;
}

// Append a message bubble to the chat
function addMessage(message, sender = 'visitor') {
    const messageContainer = document.getElementById('message-container');
    if (!messageContainer || !message || message.trim() === '')
        return;
 
    const isVisitor = sender === 'visitor';
    const row = document.createElement('div');
    row.className = `flex ${isVisitor ? 'justify-end' : 'justify-start'}`;
 
    if (!isVisitor) {
        const label = document.createElement('div');
        label.className = 'text-xs text-slate-400 mb-1 ml-1';
        label.textContent = sender === 'bot' ? '🤖 Bot' : '✏️ Arman';
 
        const col = document.createElement('div');
        col.className = 'flex flex-col items-start max-w-[80%]';
        col.appendChild(label);
 
        const bubble = document.createElement('div');
        bubble.className = 'bg-white border border-slate-200 p-3 rounded-lg rounded-tl-none shadow-sm text-slate-700 w-full';
        bubble.style.whiteSpace = 'pre-wrap';
        bubble.textContent = message.trim();
 
        col.appendChild(bubble);
        row.appendChild(col);
    } else {
        const bubble = document.createElement('div');
        bubble.className = 'max-w-[80%] bg-sky-600 border border-sky-700 p-3 rounded-lg rounded-tr-none shadow-sm text-white';
        bubble.style.whiteSpace = 'pre-wrap';
        bubble.textContent = message.trim();
        row.appendChild(bubble);
    }
 
    messageContainer.appendChild(row);
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

// Send visitor message
function sendMessage() {
    const message = chatInput.value.trim();
    if (message === '')
        return;
 
    chatInput.value = '';
    socket.emit('visitor_message', { message });
    addMessage(message, 'visitor');
}

// Toggle chat panel open/closed
function toggleChat() {
    if (chatWindow.classList.contains('hidden')) {
        chatWindow.classList.remove('hidden');
        setTimeout(() => {
            chatWindow.classList.remove('scale-95', 'opacity-0');
            chatWindow.classList.add('scale-100', 'opacity-100');
            if (isChating)
                chatInput.focus();
            else
                visitorNameInput.focus();
        }, 10);
    } else {
        chatWindow.classList.remove('scale-100', 'opacity-100');
        chatWindow.classList.add('scale-95', 'opacity-0');
        setTimeout(() => chatWindow.classList.add('hidden'), 300);
    }
}

// Enter key shortcuts
function startChatOnEnter(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        startChat();
    }
}

function sendMessageOnEnter(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

// Button listeners
chatToggle.addEventListener('click', toggleChat);
closeChat.addEventListener('click', toggleChat);
startChatBtn.addEventListener('click', startChat);
visitorMsgBtn.addEventListener('click', sendMessage);

// Keydown event bindings for registration layout and conversation frame
visitorNameInput.addEventListener('keydown', startChatOnEnter);
chatInput.addEventListener('keydown', sendMessageOnEnter);


// SOCKET SERVER INBOUND EVENTS
socket.on('new_message', (data) => {
    addMessage(data.text, data.sender);

    // Only speak if the message originates from the backend Bot or from Arman ('you')
    // Temporarly disabled
    // if (data.sender === 'bot' || data.sender === 'you') {
    //     speakText(data.text);
    // }
});

function displayFooterInfo() {
    const span = document.getElementById('footer-info');
    if (span) {
        const year = new Date().getFullYear();
        span.innerText = `© ${year} Arman Arakelyan`;
    }
}

window.addEventListener("load", (event) => {
    displayFooterInfo();
    // Warm up the local system speech engine index list registers
    if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
    }
});