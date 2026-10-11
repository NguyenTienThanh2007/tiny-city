"""Explicit paid bilingual HTTP/approval check. Ordinary CI never calls Gemini."""
import argparse
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from .config import Settings

CHECK = Path(__file__).resolve().parents[3] / 'scripts/architect_live_check.mjs'

async def main(base_url='http://127.0.0.1:8000'):
    settings = Settings()
    if not settings.gemini_api_key.get_secret_value().strip():
        print('NOT VERIFIED: GEMINI_API_KEY is missing. No live request was made.')
        return 2
    if settings.tiny_city_provider_mode != 'gemini':
        print('NOT VERIFIED: Live smoke requires Gemini mode, not mock mode.')
        return 2
    try:
        url = urlsplit(base_url)
        if (url.scheme != 'http' or url.hostname not in ('localhost','127.0.0.1','::1')
                or url.username or url.password or url.query or url.fragment or url.path not in ('','/')):
            raise ValueError()
        _ = url.port
    except ValueError:
        print('FAIL: Supply an HTTP loopback backend URL without credentials.')
        return 1
    env = {key: os.environ[key] for key in ('PATH','SYSTEMROOT','LANG','LC_ALL') if key in os.environ}
    try:
        process = await asyncio.create_subprocess_exec(settings.tiny_city_node_binary, str(CHECK), base_url,
            settings.gemini_model, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, env=env)
    except OSError:
        print('FAIL: NODE_UNAVAILABLE'); return 1
    try:
        output, _ = await asyncio.wait_for(process.communicate(), 310)
    except (TimeoutError, asyncio.CancelledError) as error:
        if process.returncode is None:
            process.kill()
        await process.wait()
        if isinstance(error, asyncio.CancelledError):
            raise
        print('FAIL: LIVE_CHECK_TIMEOUT'); return 1
    try:
        if len(output) > 20000:
            raise ValueError()
        report = json.loads(output)
        passed = (process.returncode == 0 and len(report['results']) == 2
            and {row['language'] for row in report['results']} == {'vi','en'}
            and all(row['result'] == 'PASS' for row in report['results']))
        print(json.dumps(report, ensure_ascii=False))
        return 0 if passed else 1
    except (ValueError, KeyError, TypeError):
        print('FAIL: LIVE_CHECK_INVALID_REPORT'); return 1

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:8000')
    raise SystemExit(asyncio.run(main(parser.parse_args().base_url)))
