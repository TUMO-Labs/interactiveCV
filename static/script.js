let socket = io();

const chatToggle = document.getElementById('chat-toggle');
const chatWindow = document.getElementById('chat-window');
const closeChat = document.getElementById('close-chat');

const regForm = document.getElementById('registration-form');
const chatInterface = document.getElementById('chat-interface');
const startChatBtn = document.getElementById('start-chat');

function showChatInterface(name) {
	regForm.classList.add('hidden');
	chatInterface.classList.remove('hidden');
	document.getElementById('display-name').innerText = name;
}

function startChat() {
	const name = document.getElementById('visitor-name').value;
	const tg = document.getElementById('visitor-tg').value;
	
	console.log(name, tg)
	if (name == "" || tg == "")
		return ;
	
	document.getElementById('visitor-name').value = "";
	document.getElementById('visitor-tg').value = "";

	socket.emit('register_visitor', {name: name, tg: tg});
	showChatInterface(name);
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

function handleKeyPress(event) {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		startChat();
	}
}

chatToggle.addEventListener('click', toggleChat);
closeChat.addEventListener('click', toggleChat);
startChatBtn.addEventListener('click', startChat);
