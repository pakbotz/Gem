"""Small server-only Gemini REST adapter; no SDK required for the review pipeline."""
from __future__ import annotations

import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from functionality.models import StrictModel


DEFAULT_MODEL = 'gemini-3.5-flash'
# Used when the configured model is overloaded or times out (newest models often are).
FALLBACK_MODEL = 'gemini-3.5-flash'
RETRYABLE = {429, 500, 503, 504}


class GeminiError(RuntimeError):
    pass


def model_chain(configured: str | None) -> list[str]:
    models = [configured or DEFAULT_MODEL, os.getenv('GEMINI_FALLBACK_MODEL', FALLBACK_MODEL)]
    return list(dict.fromkeys(m for m in models if m))


class Gemini:
    def __init__(self):
        self.key = os.getenv('GEMINI_API_KEY', '')
        self.models = model_chain(os.getenv('GEMINI_REVIEW_MODEL') or os.getenv('GEMINI_MODEL'))
        self.model = self.models[0]  # Updated to the model that actually answered.
        if not self.key:
            raise GeminiError('Set GEMINI_API_KEY on the backend')
        if not all(re.fullmatch(r'[A-Za-z0-9._-]+', m) for m in self.models):
            raise GeminiError('Invalid Gemini model identifier')

    def generate(self, instruction: str, data: dict, schema: type[StrictModel]):
        payload = {
            'systemInstruction': {'parts': [{'text': instruction}]},
            'contents': [{'role': 'user', 'parts': [{'text': json.dumps(data)}]}],
            'generationConfig': {'temperature': 0, 'responseMimeType': 'application/json',
                                 'responseJsonSchema': schema.model_json_schema()},
        }
        for model in self.models:
            request = Request(
                f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
                data=json.dumps(payload).encode(),
                headers={'Content-Type': 'application/json', 'x-goog-api-key': self.key}, method='POST',
            )
            try:
                with urlopen(request, timeout=90) as response:
                    body = json.load(response)
            except HTTPError as exc:
                if exc.code in RETRYABLE and model != self.models[-1]:
                    continue
                raise GeminiError('Gemini review failed; no report was saved. Retry after checking configuration/quota.') from None
            except (URLError, TimeoutError):
                if model != self.models[-1]:
                    continue
                raise GeminiError('Gemini review timed out; no report was saved. Please retry.') from None
            self.model = model
            return self._parse(body, schema)

    @staticmethod
    def _parse(body: dict, schema: type[StrictModel]):
        try:
            candidate = body['candidates'][0]
            if candidate.get('finishReason') != 'STOP':
                raise ValueError('Incomplete response')
            result = ''.join(p.get('text', '') for p in candidate['content']['parts'] if not p.get('thought'))
            return schema.model_validate_json(result)
        except (ValueError, KeyError, IndexError):
            # Never echo upstream bodies or request headers containing bill data/key.
            raise GeminiError('Gemini review failed; no report was saved. Retry after checking configuration/quota.') from None
