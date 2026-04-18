let socket = io();

const chatToggle = document.getElementById('chat-toggle');
const chatWindow = document.getElementById('chat-window');
const closeChat = document.getElementById('close-chat');

const regForm = document.getElementById('registration-interface');
const chatInterface = document.getElementById('chat-interface');
const startChatBtn = document.getElementById('start-chat');
const visitorMsgBtn = document.getElementById('visitor-msg');

function showChatInterface(name) {
	regForm.classList.add('hidden');
	chatInterface.classList.remove('hidden');
	document.getElementById('display-name').innerText = name;
}

function startChat() {
	const name = document.getElementById('visitor-name').value;
	const tg = document.getElementById('visitor-tg').value;
	
	if (name == "" || tg == "")
		return ;
	
	document.getElementById('visitor-name').value = "";
	document.getElementById('visitor-tg').value = "";

	socket.emit('register_visitor', {name: name, tg: tg});
	showChatInterface(name);
}

function addMessage(message, isVisitor = true) {
	const messageContainer = document.getElementById('message-container');

	if (!messageContainer || !message || message.trim() === "")
		return;

	const row = document.createElement('div');
	row.className = `flex ${isVisitor ? 'justify-end' : 'justify-start'}`;

	const bubble = document.createElement('div');
	bubble.className = isVisitor
		? 'max-w-[80%] bg-blue-100 border border-blue-200 p-3 rounded-lg rounded-tr-none shadow-sm text-slate-700'
		: 'max-w-[80%] bg-white border border-slate-200 p-3 rounded-lg rounded-tl-none shadow-sm text-slate-700';
	bubble.style.whiteSpace = 'pre-wrap';
	bubble.textContent = message.trim();

	row.appendChild(bubble);
	messageContainer.appendChild(row);
	messageContainer.scrollTop = messageContainer.scrollHeight;
}

function sendMessage() {
	const message = document.getElementById('chat-input').value;

	if (message == "")
		return ;

	document.getElementById('chat-input').value = "";
	socket.emit('visitor_message', {message: message});
	addMessage(message);
}

function toggleChat() {
	if (chatWindow.classList.contains('hidden')) {
		chatWindow.classList.remove('hidden');
		// Small delay to allow the 'hidden' removal to trigger transitions
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

function startChatOnEnter(event) {
	if (event.key === "Enter") {
		event.preventDefault();
		startChat();
	}
}

function sendMessageOnEnter(event) {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		sendMessage();
	}
}

chatToggle.addEventListener('click', toggleChat);
closeChat.addEventListener('click', toggleChat);
startChatBtn.addEventListener('click', startChat);
visitorMsgBtn.addEventListener('click', sendMessage);
