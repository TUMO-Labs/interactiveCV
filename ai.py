import os
import requests
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
GEMINI_API     = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent'

with open("system_prompt.txt", "r", encoding="utf-8") as file:
    SYSTEM_INSTRUCTIONS = file.read()


def ai_reply(user_message: str) -> str | None:
    """
    Ask Gemini about Arman.

    Returns:
        str   — the AI's answer  (show to visitor)
        None  — AI said __FALLBACK__ or the call failed  (escalate to Telegram)
    """
    if not GEMINI_API_KEY:
        print('[AI] No Gemini API key configured')
        return None

    payload = {
        'system_instruction': {
            'parts': [{'text': SYSTEM_INSTRUCTIONS}]
        },
        'contents': [
            {'role': 'user', 'parts': [{'text': user_message}]}
        ],
        'generationConfig': {
            'temperature':     0.4,
            'maxOutputTokens': 1024,
        }
    }

    try:
        r = requests.post(
            f'{GEMINI_API}?key={GEMINI_API_KEY}',
            json=payload,
            timeout=15,
        )
        data = r.json()

        # surface API-level errors clearly
        if 'error' in data:
            print(f'[AI] API error: {data["error"]}')
            return None

        text: str = (
            data
            .get('candidates', [{}])[0]
            .get('content', {})
            .get('parts', [{}])[0]
            .get('text', '')
            .strip()
        )

        if not text or '__FALLBACK__' in text:
            return None

        return text

    except Exception as e:
        print(f'[AI] Gemini error: {e}')
        return None