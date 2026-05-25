import os
import requests
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
GEMINI_API     = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent'

with open("system_prompt.txt", "r", encoding="utf-8") as file:
    SYSTEM_INSTRUCTIONS = file.read()

RATE_LIMITED = '__RATE_LIMITED__'
ERRORED      = '__ERRORED__'

# Shared helpers
def _post(payload: dict, timeout: int = 15) -> dict | None:
    try:
        r = requests.post(f'{GEMINI_API}?key={GEMINI_API_KEY}', json=payload, timeout=timeout)
        return r.json()
    except Exception as e:
        print(f'[AI] request error: {e}')
        return None
 
def _extract_text(data: dict) -> str:
    return (
        data
        .get('candidates', [{}])[0]
        .get('content', {})
        .get('parts', [{}])[0]
        .get('text', '')
        .strip()
    )
 
def _check_error(data: dict) -> str | None:
    error = data.get('error', {})
    if not error:
        return None
    code    = error.get('code')
    status  = error.get('status', '')
    message = error.get('message', '')
    print(f'[AI] API error {code} {status}: {message[:120]}')
    if code == 429 or status == 'RESOURCE_EXHAUSTED':
        return RATE_LIMITED
    return ERRORED
 
 
# Text reply
def ai_reply(user_message: str) -> str | None:
    if not GEMINI_API_KEY:
        print('[AI] No API key configured')
        return None
 
    payload = {
        'system_instruction': {'parts': [{'text': SYSTEM_INSTRUCTIONS}]},
        'contents': [{'role': 'user', 'parts': [{'text': user_message}]}],
        'generationConfig': {'temperature': 0.4, 'maxOutputTokens': 1024},
    }
 
    data = _post(payload)
    if data is None:
        return None
 
    sentinel = _check_error(data)
    if sentinel == RATE_LIMITED:
        return RATE_LIMITED
    if sentinel:
        return ERRORED
 
    text = _extract_text(data)
    if not text or '__FALLBACK__' in text:
        return None
 
    return text
 
 
# Audio transcription
def transcribe_any_language(audio_bytes: bytes) -> str | None:
    if not GEMINI_API_KEY:
        print('[AI] No API key configured')
        return None
 
    import base64
    audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
 
    payload = {
        'contents': [{
            'parts': [
                {
                    'text': (
                        'Listen carefully to this audio. Identify the language spoken '
                        'and transcribe it exactly as spoken in its native script. '
                        'Output ONLY the raw transcription text, nothing else.'
                    )
                },
                {
                    'inlineData': {
                        'mimeType': 'audio/webm',
                        'data':     audio_b64,
                    }
                }
            ]
        }],
        'generationConfig': {'temperature': 0.0},
    }
 
    data = _post(payload, timeout=20)
    if data is None:
        return None
 
    sentinel = _check_error(data)
    if sentinel:
        return None
 
    return _extract_text(data) or None
