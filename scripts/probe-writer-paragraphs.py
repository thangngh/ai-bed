import asyncio, json, sys, time
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path('Engine').resolve()))
from core.llm.custom_client import iter_stream_frames

LB = 'http://localhost:20127'
WRITER = """You are a writer of Vietnamese children's bedtime stories.

Write a story following this outline: An 4 tuoi, de tai dong vat, muc tieu dung cam. Mo bai o nha cua An. Nhan vat chinh: chu tho nho Miu. Xung dot: Miu so bong toi. Cao trao: Miu vuot qua so hai de cuu ban. Ket thuc: bai hoc ve long dung cam.

Story section types (use these EXACT type values):
- "opening" (2-3 paragraphs): Introduce main character, setting, mood
- "context" (2-3 paragraphs): Build the world, establish character relationships
- "conflict" (3-4 paragraphs): Present the main problem/conflict
- "rising_action" (2-3 paragraphs): Character attempts to solve, faces obstacles
- "climax" (2-3 paragraphs): Key moment of resolution
- "resolution" (2-3 paragraphs): Problem solved, lessons learned
- "interaction" (1-2 paragraphs): Natural pause, ask the child a question, reference child name
- "moral" (1-2 paragraphs): Gentle lesson reinforcement

**At least one section MUST have "type": "interaction" with a "prompt" field containing a question for the child.**

Output JSON ONLY (no markdown, no code fences):
{"title": "...", "content": [{"type": "opening", "text": "...", "order": 0}, {"type": "interaction", "text": "...", "prompt": "cau hoi cho be", "order": 1}, ...], "word_count": N}

Each section in content must have: type, text, order. Interaction sections must also have prompt.
All content MUST be in Vietnamese (thuan Viet). No English words except proper names."""

MODELS = ['oc/deepseek-v4-flash-free', 'oc/nemotron-3-ultra-free', 'oc/north-mini-code-free']

def section_paragraphs(text):
    # count paragraph breaks; a JSON \n\n inside a section counts as 2
    paras = [p for p in text.split('\n') if p.strip()]
    return max(1, len(paras))

async def probe(model):
    import httpx
    payload = {
        'model': model,
        'messages': [{'role': 'user', 'content': WRITER}],
        'max_tokens': 16000,
        'stream': True,
        'thinking': {'type': 'disabled'},
    }
    started = time.monotonic()
    chunks, frames, finish = [], 0, None
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=15, read=150, write=30, pool=15)) as client:
            async with client.stream('POST', f'{LB}/v1/chat/completions', json=payload) as resp:
                status = resp.status_code
                if status >= 400:
                    await resp.aread()
                async for line in resp.aiter_lines():
                    for f in iter_stream_frames([line]):
                        frames += 1
                        if f.content:
                            chunks.append(f.content)
                        if f.finish_reason:
                            finish = f.finish_reason
    except Exception as e:
        return {'model': model, 'error': f'{type(e).__name__}: {e}', 'elapsed_s': round(time.monotonic()-started,1)}

    content = ''.join(chunks)
    result = {'model': model, 'status': status, 'elapsed_s': round(time.monotonic()-started,1),
              'frames': frames, 'chars': len(content), 'finish': finish, 'error': None}
    # parse sections
    try:
        start = content.find('{')
        end = content.rfind('}')
        data = json.loads(content[start:end+1])
        sections = data.get('content', [])
        result['sections'] = len(sections)
        short = {s.get('type'): len([p for p in (s.get('text') or '').split('\n') if p.strip()]) for s in sections if len([p for p in (s.get('text') or '').split('\n') if p.strip()]) < 2}
        result['sections_lt2_paras'] = short
        result['json_ok'] = True
    except Exception as e:
        result['json_ok'] = False
        result['json_err'] = str(e)[:100]
    return result

async def main():
    results = await asyncio.gather(*[probe(m) for m in MODELS])
    out = {'startedAt': datetime.now(timezone.utc).isoformat(), 'results': results}
    stamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%S-%f')[:-3] + 'Z'
    f = Path('test-results') / f'writer-paragraphs-{stamp}.json'
    f.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    for r in results:
        if r.get('error'):
            print(f"{r['model']:<26} ERROR {r['error']}")
            continue
        verdict = 'PASS' if r['json_ok'] and not r.get('sections_lt2_paras') else 'FAIL(low-paragraph sections)'
        print(f"{r['model']:<26} {r['elapsed_s']:>5}s {r['chars']:>6} chars {r['finish']} json={r['json_ok']} sections={r.get('sections')} short={r.get('sections_lt2_paras') or 'none'} {verdict}")
    print(f'Saved {f}')

asyncio.run(main())
