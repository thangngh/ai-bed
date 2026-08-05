import asyncio, json, os, sys, time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path('Engine').resolve()))
from core.llm.custom_client import iter_stream_frames

LB = os.getenv('NINEROUTER_LB_URL', 'http://localhost:20127')
PROMPT = 'Viết một đoạn truyện ngắn tiếng Việt cho bé 5 tuổi về một chú gấu bông biết chia sẻ. Khoảng 100 từ.'
MAX_TOKENS = int(os.getenv('PROBE_MAX_TOKENS', '16000'))
PER_CALL_TIMEOUT = float(os.getenv('PROBE_CALL_TIMEOUT', '150'))

MODELS = [
    'oc/deepseek-v4-flash-free',   # reasoning model
    'oc/nemotron-3-ultra-free',
    'oc/north-mini-code-free',
]
THINKING_MODES = ['enabled', 'disabled']

def incomplete(content):
    if not content.strip():
        return 'empty'
    opens, closes = content.count('{'), content.count('}')
    if opens or closes:
        return 'json-unbalanced' if opens != closes else 'json-balanced'
    last = content.rstrip()[-40:]
    if not (last.rstrip().endswith(('.', '!', '?', '"', '\u201d', ')' ,'}'))):
        return 'ends-abrupt'
    return 'ends-clean'

async def probe(model, thinking):
    payload = {
        'model': model,
        'messages': [{'role': 'user', 'content': PROMPT}],
        'max_tokens': MAX_TOKENS,
        'stream': True,
    }
    if thinking:
        payload['thinking'] = {'type': thinking}

    import httpx
    chunks, reasoning = [], []
    frames = 0
    finish_reason = None
    first_content_at = None
    started = time.monotonic()
    status = None
    error = None
    raw_count = 0
    timeout = httpx.Timeout(connect=15.0, read=PER_CALL_TIMEOUT, write=30.0, pool=15.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream('POST', f'{LB}/v1/chat/completions', json=payload) as resp:
                status = resp.status_code
                if status >= 400:
                    await resp.aread()
                async for line in resp.aiter_lines():
                    raw_count += 1
                    for frame in iter_stream_frames([line]):
                        frames += 1
                        if frame.content:
                            if first_content_at is None:
                                first_content_at = time.monotonic() - started
                            chunks.append(frame.content)
                        if frame.reasoning:
                            reasoning.append(frame.reasoning)
                        if frame.finish_reason:
                            finish_reason = frame.finish_reason
    except Exception as e:
        error = f'{type(e).__name__}: {e}'

    content = ''.join(chunks)
    elapsed = time.monotonic() - started
    return {
        'model': model,
        'thinking': thinking or 'default',
        'status': status,
        'elapsed_s': round(elapsed, 1),
        'raw_lines': raw_count,
        'frames': frames,
        'content_chars': len(content),
        'reasoning_chars': len(''.join(reasoning)),
        'finish_reason': finish_reason,
        'first_content_at_s': round(first_content_at, 1) if first_content_at is not None else None,
        'words': len(content.split()),
        'completeness': incomplete(content) if not error else 'error',
        'error': error,
        'sample': content[:160],
        'tail': content[-80:],
    }

async def main():
    tasks = []
    for m in MODELS:
        for t in THINKING_MODES:
            tasks.append(probe(m, t))
    tasks.append(probe('oc/deepseek-v4-flash-free', None))  # default = no param
    results = await asyncio.gather(*tasks)

    out = {'startedAt': datetime.now(timezone.utc).isoformat(), 'lb': LB, 'max_tokens': MAX_TOKENS, 'results': results}
    stamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%S-%f')[:-3] + 'Z'
    f = Path('test-results') / f'stream-thinking-{stamp}.json'
    f.parent.mkdir(exist_ok=True)
    f.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')

    hdr = f"{'model':<26}{'thinking':<10}{'st':<4}{'s':>6}{'fr':>5}{'cont':>6}{'reas':>7}{'finish':<7}{'words':>6}  verdict"
    print(hdr)
    print('-' * len(hdr))
    for r in results:
        if r['error']:
            verdict = f"ERROR {r['error']}"
        elif not r['content_chars']:
            verdict = 'EMPTY'
        elif r['completeness'] == 'json-unbalanced':
            verdict = 'TRUNCATED-JSON'
        elif r['completeness'] == 'ends-abrupt':
            verdict = 'ABRUPT-END'
        else:
            verdict = 'COMPLETE'
        print(
            f"{r['model']:<26}{r['thinking']:<10}{r['status'] or '-':<4}"
            f"{r['elapsed_s']:>6}{r['frames']:>5}{r['content_chars']:>6}{r['reasoning_chars']:>7}"
            f"{(r['finish_reason'] or '-')[:6]:<7}{r['words']:>6}  {verdict}"
        )
    print(f'\nSaved {f}')

asyncio.run(main())
