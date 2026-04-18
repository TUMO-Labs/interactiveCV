let socket = io();

const chatToggle = document.getElementById('chat-toggle');
const chatWindow = document.getElementById('chat-window');
const closeChat = document.getElementById('close-chat');

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

chatToggle.addEventListener('click', toggleChat);
closeChat.addEventListener('click', toggleChat);