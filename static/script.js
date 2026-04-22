const socket = io();
 
const chatToggle = document.getElementById('chat-toggle');
const chatWindow  = document.getElementById('chat-window');
const closeChat   = document.getElementById('close-chat');
const regForm     = document.getElementById('registration-interface');
const chatInterface = document.getElementById('chat-interface');
const startChatBtn  = document.getElementById('start-chat');
const visitorMsgBtn = document.getElementById('visitor-msg');

// Show chat interface after registration
function showChatInterface(name) {
    regForm.classList.add('hidden');
    chatInterface.classList.remove('hidden');
    document.getElementById('display-name').innerText = name;
}

// Register visitor and switch to chat view
function startChat() {
    const name = document.getElementById('visitor-name').value.trim();
    const tg   = document.getElementById('visitor-tg').value.trim();
 
    if (name === '' || tg === '')
        return;
 
    document.getElementById('visitor-name').value = '';
    document.getElementById('visitor-tg').value   = '';
 
    socket.emit('register_visitor', { name, tg });
    showChatInterface(name);
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
    const input   = document.getElementById('chat-input');
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

socket.on('chat_closed', (data) => {
    const messageContainer = document.getElementById('message-container');
    if (!messageContainer) return;

    const notice = document.createElement('div');
    notice.className = 'text-center text-xs text-slate-400 py-2';
    notice.textContent = data.message || 'This conversation has been closed.';
    messageContainer.appendChild(notice);
    messageContainer.scrollTop = messageContainer.scrollHeight;
 
    const input  = document.getElementById('chat-input');
    const button = document.getElementById('visitor-msg');
    if (input)  { input.disabled = true;  input.placeholder = 'Chat closed.'; }
    if (button) { button.disabled = true; button.classList.add('opacity-50', 'cursor-not-allowed'); }
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
 