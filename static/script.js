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

let isChating = false;
let recognition = null;
let isRecording = false;

// Check browser compatibility
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    
    recognition.continuous = true;      // Keep listening even if the user pauses
    recognition.interimResults = true;  // Show live predictions as they speak
    recognition.lang = 'en-US';         // Adjust language choice here if preferred

    recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            }
        }
        
        if (finalTranscript) {
            if (chatInput.value.trim() !== '') {
                chatInput.value = chatInput.value.trim() + ' ' + finalTranscript.trim();
            } else {
                chatInput.value = finalTranscript.trim();
            }
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        stopVoiceRecording();
    };

    recognition.onend = () => {
        if (isRecording) stopVoiceRecording();
    };
} else {
    // Hide or disable the option if the user's platform doesn't support it
    voiceBtn.classList.add('hidden');
}

function startVoiceRecording() {
    isRecording = true;
    recognition.start();

    // UI Updates: Switch styles to active recording indicators
    micPulse.classList.remove('hidden');
    voiceBtn.classList.remove('bg-slate-100', 'text-slate-600', 'hover:bg-slate-200');
    voiceBtn.classList.add('bg-red-500', 'text-white', 'hover:bg-red-600');
}

function stopVoiceRecording() {
    isRecording = false;
    recognition.stop();

    // UI Updates: Revert elements back to default states
    micPulse.classList.add('hidden');
    voiceBtn.classList.remove('bg-red-500', 'text-white', 'hover:bg-red-600');
    voiceBtn.classList.add('bg-slate-100', 'text-slate-600', 'hover:bg-slate-200');

    // Trigger the existing message submission logic if text was captured
    setTimeout(() => {
        sendMessage();
    }, 150);
}

// Toggle recording handler execution
voiceBtn.addEventListener('click', () => {
    if (!isRecording) {
        startVoiceRecording();
    } else {
        stopVoiceRecording();
    }
});

// Show chat interface after registration
function showChatInterface(name) {
    regForm.classList.add('hidden');
    chatInterface.classList.remove('hidden');
    document.getElementById('display-name').innerText = name;
}

// Register visitor and switch to chat view
function startChat() {
    const name = document.getElementById('visitor-name').value.trim();
 
    if (name === '')
        return;
 
    document.getElementById('visitor-name').value = '';
 
    socket.emit('register_visitor', { name });
    showChatInterface(name);
    document.getElementById('chat-input').focus();
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
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (message === '')
        return;
 
    input.value = '';
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
                document.getElementById('chat-input').focus();
            else
                document.getElementById('visitor-name').focus();
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

// Server -> client events
socket.on('new_message', (data) => {
    addMessage(data.text, data.sender);
});

// Display footer info after window loades
function displayFooterInfo(params) {
    const span = document.getElementById('footer-info');
    const year = new Date().getFullYear();

    span.innerText = `© ${year} Arman Arakelyan`;
}

window.addEventListener("load", (event) => {
    displayFooterInfo();
});
