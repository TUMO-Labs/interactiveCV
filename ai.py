import os
import requests
import base64
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
GEMINI_API     = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent'

with open("system_prompt.txt", "r", encoding="utf-8") as file:
    SYSTEM_INSTRUCTIONS = file.read()


def transcribe_any_language(audio_bytes: bytes) -> str | None:
    if not GEMINI_API_KEY:
        return None

    # Encode raw audio data to base64
    audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')

    payload = {
        'contents': [
            {
                'parts': [
                    {
                        'text': (
                            "Listen carefully to this audio track. Identify the language spoken "
                            "(e.g., English, Armenian, Russian, etc.) and transcribe it exactly "
                            "as spoken into its native script. Output ONLY the raw transcription text. "
                            "Do not translate it to English, do not explain it, and do not add notes."
                        )
                    },
                    {
                        'inlineData': {
                            'mimeType': 'audio/webm',
                            'data': audio_base64
                        }
                    }
                ]
            }
        ],
        'generationConfig': {
            'temperature': 0.0,  # 0.0 forces literal accuracy over creative variation
        }
    }

    try:
        r = requests.post(f'{GEMINI_API}?key={GEMINI_API_KEY}', json=payload, timeout=20)
        data = r.json()
        text = data['candidates'][0]['content']['parts'][0]['text'].strip()
        return text
    except Exception as e:
        print(f'[Gemini Audio Error] {e}')
        return None


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