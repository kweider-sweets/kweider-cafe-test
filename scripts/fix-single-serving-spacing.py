from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')

old = text

replacements = {
    'src=" Single‑Serving Selection.webp"': 'src="Single‑Serving Selection.webp"',
    'data-img=" Single‑Serving Selection.webp"': 'data-img="Single‑Serving Selection.webp"',
    'data-name-en=" Single‑Serving Selection"': 'data-name-en="Single‑Serving Selection"',
    '<div class="mini-name-en"> Single‑Serving Selection</div>': '<div class="mini-name-en">Single‑Serving Selection</div>',
}

expected_counts = {
    'src=" Single‑Serving Selection.webp"': 2,
    'data-img=" Single‑Serving Selection.webp"': 1,
    'data-name-en=" Single‑Serving Selection"': 1,
    '<div class="mini-name-en"> Single‑Serving Selection</div>': 1,
}

for source, target in replacements.items():
    count = text.count(source)
    expected = expected_counts[source]
    if count != expected:
        raise SystemExit(f'Unexpected count for {source!r}: found {count}, expected {expected}')
    text = text.replace(source, target)

if text == old:
    raise SystemExit('No changes made')

if 'src=" Single‑Serving Selection.webp"' in text:
    raise SystemExit('Leading-space src remains')
if 'data-img=" Single‑Serving Selection.webp"' in text:
    raise SystemExit('Leading-space data-img remains')
if 'data-name-en=" Single‑Serving Selection"' in text:
    raise SystemExit('Leading-space English data-name remains')
if '<div class="mini-name-en"> Single‑Serving Selection</div>' in text:
    raise SystemExit('Leading-space visible English name remains')

# Ensure the actual repository filename spelling is preserved exactly.
if text.count('Single‑Serving Selection.webp') < 3:
    raise SystemExit('Expected Single‑Serving Selection.webp references missing after patch')

path.write_text(text, encoding='utf-8')
print('Single‑Serving Selection leading spaces removed safely.')
