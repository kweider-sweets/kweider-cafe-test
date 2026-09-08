from pathlib import Path
import re

path = Path('index.html')
text = path.read_text(encoding='utf-8')

pattern = re.compile(
    r'(<div class="item-card" onclick="openDetails\(this\)" '
    r'data-name-ar="وردات بالقشطة" data-name-en="Cream Wardat" '
    r'data-desc-ar="[^"]*" data-desc-en="[^"]*")'
    r'(><span class="item-price">£3\.00</span><img src="wardat\.webp")'
)

matches = list(pattern.finditer(text))
if len(matches) != 1:
    raise SystemExit(f'Expected exactly one unfixed Cream Wardat card, found {len(matches)}')

replacement = r'\1 data-price="£3.00" data-img="wardat.webp"\2'
updated = pattern.sub(replacement, text, count=1)

if updated == text:
    raise SystemExit('Cream Wardat patch made no change')

# Validate the exact resulting card opening tag.
card_match = re.search(
    r'<div class="item-card" onclick="openDetails\(this\)"[^>]*data-name-en="Cream Wardat"[^>]*>',
    updated,
)
if not card_match:
    raise SystemExit('Cream Wardat card not found after patch')

tag = card_match.group(0)
required = ['data-price="£3.00"', 'data-img="wardat.webp"']
for item in required:
    if tag.count(item) != 1:
        raise SystemExit(f'Missing or duplicated {item}')

# Do not invent allergy information.
if 'data-allergy=' in tag:
    raise SystemExit('Unexpected data-allergy was added to Cream Wardat')

path.write_text(updated, encoding='utf-8')
print('Cream Wardat: added only data-price and data-img.')
