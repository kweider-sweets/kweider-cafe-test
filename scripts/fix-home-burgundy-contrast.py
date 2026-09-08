from pathlib import Path

index = Path('index.html')
text = index.read_text(encoding='utf-8')

old_home = '''        .home-cat-text {
            background: linear-gradient(
                to bottom,
                #621922 0%,
                var(--menu-burgundy) 44%,
                #421019 76%,
                #241618 100%
            );
        }
'''
new_home = '''        .home-cat-text {
            background: linear-gradient(
                to bottom,
                #7A2030 0%,
                #681925 34%,
                var(--menu-burgundy) 70%,
                #421019 88%,
                #241618 100%
            );
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
        }
'''

old_sep = '''            box-shadow: 0 0 8px rgba(198,161,91,0.22);
            animation: kweiderGoldWave 5.8s ease-in-out infinite;
'''
new_sep = '''            box-shadow: 0 0 10px rgba(198,161,91,0.34);
            animation: kweiderGoldWave 5.8s ease-in-out infinite;
'''

if text.count(old_home) != 1:
    raise SystemExit(f'Expected home category luxury block once, found {text.count(old_home)}')
if text.count(old_sep) != 1:
    raise SystemExit(f'Expected home separator shadow block once, found {text.count(old_sep)}')

patched = text.replace(old_home, new_home, 1).replace(old_sep, new_sep, 1)

# Ensure no product/data/script content changed: only these exact CSS fragments are allowed.
restored = patched.replace(new_home, old_home, 1).replace(new_sep, old_sep, 1)
if restored != text:
    raise SystemExit('Reversibility guard failed')

index.write_text(patched, encoding='utf-8')

sw = Path('service-worker.js')
sw_text = sw.read_text(encoding='utf-8')
old_cache = 'const CACHE = "kweider-customer-v4.5.12";'
new_cache = 'const CACHE = "kweider-customer-v4.5.13";'
if sw_text.count(old_cache) != 1:
    raise SystemExit('Expected v4.5.12 cache exactly once')
sw.write_text(sw_text.replace(old_cache, new_cache, 1), encoding='utf-8')

print('Home category burgundy contrast patch validated.')
