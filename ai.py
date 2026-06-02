import os
import io
import base64
import wave
import datetime
import requests
from config import app

GEMINI_API_KEY = app.config.get('GEMINI_API_KEY', '') or ''
TEXT_MODEL     = app.config.get('TEXT_MODEL', 'gemini-2.5-flash')
GEMINI_API     = f'https://generativelanguage.googleapis.com/v1beta/models/{TEXT_MODEL}:generateContent'

# ---------------------------------------------------------------------------
# Gemini Live API  –  model & WebSocket endpoint
# ---------------------------------------------------------------------------
LIVE_MODEL  = os.getenv('LIVE_MODEL', 'gemini-2.5-flash-native-audio-preview-12-2025')
LIVE_WS_URL = (
    'wss://generativelanguage.googleapis.com/ws/'
    'google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
)

with open("system_prompt.txt", "r", encoding="utf-8") as file:
    SYSTEM_INSTRUCTIONS = file.read()

print(f'[AI] Text model : {TEXT_MODEL}')
print(f'[AI] Live model : {LIVE_MODEL}')

RATE_LIMITED = '__RATE_LIMITED__'
ERRORED      = '__ERRORED__'
FALLBACK     = '__FALLBACK__'


# ---------------------------------------------------------------------------
# Shared REST helpers  (used by legacy ai_reply / tts_generate paths)
# ---------------------------------------------------------------------------

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


def _pcm_to_wav_bytes(
    pcm_bytes: bytes,
    channels: int = 1,
    rate: int = 24000,
    sample_width: int = 2,
) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(rate)
        wf.writeframes(pcm_bytes)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Live API – ephemeral token provisioning via google-genai SDK
# ---------------------------------------------------------------------------

def provision_live_token() -> str | None:
    """
    Mint a short-lived ephemeral token the browser uses to open a WebSocket
    directly to the Gemini Live API.

    Uses the official google-genai SDK so we hit the correct endpoint
    (/v1alpha/ephemeralTokens) with the right auth scheme.

    Returns the token string (token.name) or None on failure.
    """
    if not GEMINI_API_KEY:
        print('[AI] No API key — cannot provision Live token')
        return None

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        print('[AI] google-genai SDK not installed — run: pip install google-genai')
        return None

    try:
        # The Client must be initialised with v1alpha to reach ephemeralTokens
        client = genai.Client(
            api_key=GEMINI_API_KEY,
            http_options={'api_version': 'v1alpha'},
        )

        now        = datetime.datetime.now(tz=datetime.timezone.utc)
        expire     = now + datetime.timedelta(minutes=30)
        new_sess   = now + datetime.timedelta(minutes=2)

        # Build the fallback tool declaration
        fallback_tool = types.Tool(
            function_declarations=[
                types.FunctionDeclaration(
                    name='trigger_fallback',
                    description=(
                        'Call this function when the user asks something you cannot '
                        'answer based on your system instructions. Do NOT guess or '
                        'hallucinate. Calling this will route the visitor to a human operator.'
                    ),
                    parameters=types.Schema(
                        type='OBJECT',
                        properties={},
                    ),
                )
            ]
        )

        token = client.auth_tokens.create(
            config=types.CreateAuthTokenConfig(
                uses=1,
                expire_time=expire,
                new_session_expire_time=new_sess,
                live_connect_constraints=types.LiveConnectConstraints(
                    model=f'models/{LIVE_MODEL}',
                    config=types.LiveConnectConfig(
                        response_modalities=['AUDIO'],
                        system_instruction=types.Content(
                            parts=[types.Part(text=SYSTEM_INSTRUCTIONS)]
                        ),
                        tools=[fallback_tool],
                        temperature=0.4,
                        input_audio_transcription=types.AudioTranscriptionConfig(),
                        output_audio_transcription=types.AudioTranscriptionConfig(),
                    ),
                ),
            )
        )

        if not token or not token.name:
            print('[AI] ephemeral token response missing .name field')
            return None

        print(f'[AI] Ephemeral Live token provisioned: {token.name[:24]}…')
        return token.name

    except Exception as e:
        print(f'[AI] provision_live_token error: {e}')
        return None


def get_live_ws_url(token: str) -> str:
    """
    Build the WebSocket URL the browser connects to.

    Ephemeral tokens require the v1alpha BidiGenerateContentConstrained endpoint
    and the token is passed as the `access_token` query parameter.
    """
    return (
        'wss://generativelanguage.googleapis.com/ws/'
        'google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained'
        f'?access_token={token}'
    )


# ---------------------------------------------------------------------------
# Legacy REST paths  (kept intact – used when Live API is not active)
# ---------------------------------------------------------------------------

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
    if not text or FALLBACK in text:
        return None

    return text


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
    """Legacy TTS — only used when ENABLE_TTS=true and Live API is not active."""
    TTS_API   = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent'
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