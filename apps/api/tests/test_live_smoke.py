import asyncio
import json
from unittest.mock import AsyncMock
import pytest
from tiny_city_api import live_smoke
from tiny_city_api.config import Settings

def config(monkeypatch, **kwargs):
    monkeypatch.setattr(live_smoke, 'Settings', lambda: Settings(_env_file=None, **kwargs))

def test_missing_key_or_mock_mode_never_starts_paid_check(monkeypatch, capsys):
    start = AsyncMock(); monkeypatch.setattr(live_smoke.asyncio, 'create_subprocess_exec', start)
    for kwargs in ({'gemini_api_key':''}, {'gemini_api_key':'test-placeholder','tiny_city_provider_mode':'mock'}):
        config(monkeypatch, **kwargs)
        assert asyncio.run(live_smoke.main()) == 2
    start.assert_not_called()
    assert 'NOT VERIFIED' in capsys.readouterr().out

@pytest.mark.parametrize('url', ['https://example.com','http://example.com','http://name:password@localhost:8000','http://localhost:8000?key=private','http://localhost:8000/not-root','http://localhost:invalid'])
def test_live_check_only_targets_credential_free_loopback(monkeypatch, url):
    config(monkeypatch, gemini_api_key='test-placeholder')
    start = AsyncMock(); monkeypatch.setattr(live_smoke.asyncio, 'create_subprocess_exec', start)
    assert asyncio.run(live_smoke.main(url)) == 1
    start.assert_not_called()

@pytest.mark.parametrize('success', [True,False])
def test_check_requires_both_languages_and_does_not_pass_key_to_node(monkeypatch, capsys, success):
    monkeypatch.setenv('GEMINI_API_KEY','test-placeholder')
    config(monkeypatch, gemini_api_key='test-placeholder')
    report = {'results':[{'language':'vi','result':'PASS'},{'language':'en','result':'PASS' if success else 'FAIL'}]}
    class Process:
        returncode = 0 if success else 1
        async def communicate(self): return json.dumps(report).encode(), b''
    start = AsyncMock(return_value=Process()); monkeypatch.setattr(live_smoke.asyncio,'create_subprocess_exec',start)
    assert asyncio.run(live_smoke.main('http://127.0.0.1:8010')) == (0 if success else 1)
    assert 'GEMINI_API_KEY' not in start.call_args.kwargs['env']
    assert 'test-placeholder' not in capsys.readouterr().out
