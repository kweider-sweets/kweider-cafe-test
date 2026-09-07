from pathlib import Path
import re

index = Path('index.html')
sw = Path('service-worker.js')
text = index.read_text(encoding='utf-8')

fa_link_re = re.compile(r'\s*<link\s+rel=["\']stylesheet["\']\s+href=["\']https://cdnjs\.cloudflare\.com/ajax/libs/font-awesome/6\.4\.0/css/all\.min\.css["\']\s*/?>', re.I)
if len(fa_link_re.findall(text)) != 1:
    raise SystemExit('Expected exactly one FontAwesome 6.4.0 stylesheet link')
text = fa_link_re.sub('', text, count=1)

icon_re = re.compile(r'<i\s+class=["\']([^"\']*\bfa[^"\']*)["\']\s*></i>', re.I)
classes = [m.group(1).strip() for m in icon_re.finditer(text)]
expected = {
    'far fa-hand-pointer',
    'fas fa-arrow-left',
    'fas fa-arrow-up',
    'fas fa-map-marker-alt',
    'fab fa-instagram',
    'fab fa-facebook-f',
    'fab fa-tiktok',
    'fas fa-shield-alt',
}
unknown = sorted(set(classes) - expected)
if unknown:
    raise SystemExit(f'Unknown FontAwesome icons found: {unknown}')
if not classes:
    raise SystemExit('No FontAwesome icon usages found')

icons = {
'far fa-hand-pointer': '''<svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8.8 3.2a1.8 1.8 0 0 1 3.6 0v6.1l.7-.8a1.7 1.7 0 0 1 2.6.2l.5.8.6-.5a1.7 1.7 0 0 1 2.5.5l.3.6.3-.2a1.7 1.7 0 0 1 2.4.9c.2.5.3 1 .2 1.5l-.7 4.6a5.5 5.5 0 0 1-5.4 4.6h-3.5a5.5 5.5 0 0 1-4.7-2.7l-2.6-4.4a1.8 1.8 0 0 1 2.9-2l.3.3V3.2Zm1.8 0v10.5l-2.5-1.9c-.5-.4-1.2.2-.9.8l2.6 4.4a3.7 3.7 0 0 0 3.2 1.8h3.5a3.7 3.7 0 0 0 3.6-3.1l.7-4.6c.1-.4-.4-.7-.7-.4l-1.3 1.1v-1.5c0-.4-.5-.6-.8-.3l-1.8 1.6v-1.8c0-.4-.5-.6-.8-.3l-2 2V3.2a.9.9 0 0 0-1.8 0Z"/></svg>''',
'fas fa-arrow-left': '''<svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M20 11H7.8l4.6-4.6L11 5l-7 7 7 7 1.4-1.4L7.8 13H20v-2Z"/></svg>''',
'fas fa-arrow-up': '''<svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="m12 4-7 7 1.4 1.4L11 7.8V20h2V7.8l4.6 4.6L19 11l-7-7Z"/></svg>''',
'fas fa-map-marker-alt': '''<svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.1 7 13 7 13s7-7.9 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z"/></svg>''',
'fab fa-instagram': '''<svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm5.5-3.2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z"/></svg>''',
'fab fa-facebook-f': '''<svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M13.8 22v-8h2.7l.4-3.1h-3.1V8.9c0-.9.3-1.5 1.6-1.5H17V4.6c-.3 0-1.2-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2v2.2H7.8V14h2.7v8h3.3Z"/></svg>''',
'fab fa-tiktok': '''<svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14 3h2.8c.3 1.8 1.4 3.1 3.2 3.6v2.8a8 8 0 0 1-4-1.5v6.5a5.4 5.4 0 1 1-5.4-5.4c.4 0 .8 0 1.2.1V12a2.7 2.7 0 1 0 1.2 2.3V3h1Z"/></svg>''',
'fas fa-shield-alt': '''<svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm0 2.2L18 6.5V11c0 3.9-2.4 7.5-6 8.9-3.6-1.4-6-5-6-8.9V6.5l6-2.3Z"/></svg>''',
}

for cls, svg in icons.items():
    text = re.sub(r'<i\s+class=["\']' + re.escape(cls) + r'["\']\s*></i>', svg, text)

if re.search(r'font-awesome|fontawesome|cdnjs\.cloudflare\.com/ajax/libs/font-awesome', text, re.I):
    raise SystemExit('FontAwesome reference remains after patch')
if re.search(r'<i\s+class=["\'][^"\']*\bfa', text, re.I):
    raise SystemExit('FontAwesome icon markup remains after patch')

style_marker = "        :root {\n"
if text.count(style_marker) != 1:
    raise SystemExit('Could not find the main style marker')
svg_css = "        .menu-icon { width: 1em; height: 1em; display: inline-block; flex: 0 0 auto; vertical-align: -0.125em; fill: currentColor; }\n        .copyright-notice .menu-icon { color: #e74c3c; margin-right: 5px; }\n\n"
text = text.replace(style_marker, svg_css + style_marker, 1)

# Remove the now-obsolete selector that only styled FontAwesome <i> elements.
text = text.replace('        .copyright-notice i { color: #e74c3c; margin-right: 5px; }\n', '')

index.write_text(text, encoding='utf-8')

sw_text = sw.read_text(encoding='utf-8')
old_cache = 'const CACHE = "kweider-customer-v4.5.9";'
new_cache = 'const CACHE = "kweider-customer-v4.5.10";'
if sw_text.count(old_cache) != 1:
    raise SystemExit('Unexpected customer service worker cache version')
sw.write_text(sw_text.replace(old_cache, new_cache, 1), encoding='utf-8')

print(f'Replaced {len(classes)} FontAwesome icon instances with inline local SVG icons.')
