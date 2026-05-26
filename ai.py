import os
import io
import base64
import wave
import requests
from config import app

GEMINI_API_KEY = app.config.get('GEMINI_API_KEY', '') or ''
TEXT_MODEL     = app.config.get('TEXT_MODEL', 'gemini-2.5-flash')
GEMINI_API     = f'https://generativelanguage.googleapis.com/v1beta/models/{TEXT_MODEL}:generateContent'
TTS_API        = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent'

with open("system_prompt.txt", "r", encoding="utf-8") as file:
    SYSTEM_INSTRUCTIONS = file.read()

print(f'[AI] Text model: {TEXT_MODEL}')

RATE_LIMITED = '__RATE_LIMITED__'
ERRORED      = '__ERRORED__'

# Shared helpers
def _post(payload: dict, timeout: int = 15, api_url: str = GEMINI_API) -> dict | None:
    try:
        r = requests.post(f'{api_url}?key={GEMINI_API_KEY}', json=payload, timeout=timeout)
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


def _extract_audio_b64(data: dict) -> str:
    return (
        data
        .get('candidates', [{}])[0]
        .get('content', {})
        .get('parts', [{}])[0]
        .get('inlineData', {})
        .get('data', '')
    )


def _pcm_to_wav_bytes(pcm_bytes: bytes, channels: int = 1, rate: int = 24000, sample_width: int = 2) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(rate)
        wf.writeframes(pcm_bytes)
    return buf.getvalue()
 
 
# Text reply
def ai_reply(user_message: str) -> str | None:
    if not GEMINI_API_KEY:
        print('[AI] No API key configured')
        return None

    print(f'[AI] Using text model: {TEXT_MODEL}')
 
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


def tts_generate(text: str) -> bytes | None:
    if not app.config.get('ENABLE_TTS'):
        print('[TTS] Disabled (ENABLE_TTS is false)')
        return None
    if not GEMINI_API_KEY:
        print('[AI] No API key configured')
        return None

    voice_name = app.config.get('TTS_VOICE_NAME', 'Kore')
    model_name = app.config.get('TTS_MODEL', 'gemini-3.1-flash-tts-preview')

    if not text:
        print('[TTS] Empty text, skipping')
        return None
    if len(text) > 2000:
        print(f'[TTS] Text too long ({len(text)} chars), skipping')
        return None

    prompt = (
        'Synthesize speech for the following transcript.\n\n'
        'TRANSCRIPT:\n'
        f'{text}'
    )

    payload = {
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {
            'responseModalities': ['AUDIO'],
            'speechConfig': {
                'voiceConfig': {
                    'prebuiltVoiceConfig': {
                        'voiceName': voice_name,
                    }
                }
            },
        },
        'model': model_name,
    }

    print(f'[TTS] Requesting audio (model={model_name}, voice={voice_name})')
    data = _post(payload, timeout=25, api_url=TTS_API)
    if data is None:
        print('[TTS] No response data')
        return None

    sentinel = _check_error(data)
    if sentinel:
        print(f'[TTS] API error sentinel: {sentinel}')
        return None

    audio_b64 = _extract_audio_b64(data)
    if not audio_b64:
        print('[TTS] Empty audio payload')
        return None

    try:
        pcm = base64.b64decode(audio_b64)
    except Exception as e:
        print(f'[AI] audio decode error: {e}')
        return None

    print(f'[TTS] Audio decoded ({len(pcm)} bytes PCM)')
    return _pcm_to_wav_bytes(pcm)
