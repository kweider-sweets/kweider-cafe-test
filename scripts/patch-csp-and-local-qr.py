from pathlib import Path
import re

SUPABASE_ORIGIN = "https://fwjiceleybxhgetsvsvp.supabase.co"
TURNSTILE_ORIGIN = "https://challenges.cloudflare.com"
CDN_QR = "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js"

REWARDS_CSP = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "object-src 'none'; "
    "form-action 'self'; "
    f"script-src 'self' {TURNSTILE_ORIGIN}; "
    "script-src-attr 'none'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "font-src 'self' data:; "
    f"connect-src 'self' {SUPABASE_ORIGIN} {TURNSTILE_ORIGIN}; "
    f"frame-src {TURNSTILE_ORIGIN}; "
    f"worker-src 'self' blob: {TURNSTILE_ORIGIN}; "
    "media-src 'self' blob:; "
    "manifest-src 'self'; "
    "upgrade-insecure-requests"
)

STAFF_CSP = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "object-src 'none'; "
    "form-action 'self'; "
    "script-src 'self'; "
    "script-src-attr 'none'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "font-src 'self' data:; "
    f"connect-src 'self' {SUPABASE_ORIGIN}; "
    "frame-src 'none'; "
    "worker-src 'self' blob:; "
    "media-src 'self' blob:; "
    "manifest-src 'self'; "
    "upgrade-insecure-requests"
)

SCRIPT_RE = re.compile(r"<script(?P<attrs>[^>]*)>(?P<body>.*?)</script>", re.I | re.S)
CDN_QR_RE = re.compile(
    r"<script\b(?=[^>]*\bsrc=[\"']" + re.escape(CDN_QR) + r"[\"'])[^>]*>\s*</script>",
    re.I | re.S,
)
INLINE_HANDLER_RE = re.compile(r"\son[a-zA-Z]+\s*=", re.I)


def insert_csp(path: Path, csp: str) -> None:
    text = path.read_text(encoding="utf-8")
    if re.search(r"http-equiv=[\"']Content-Security-Policy[\"']", text, re.I):
        raise SystemExit(f"{path}: CSP already exists")
    match = re.search(r"<meta\s+charset=[\"']utf-8[\"']\s*/?>", text, re.I)
    if not match:
        raise SystemExit(f"{path}: charset meta not found")
    meta = f'\n    <meta http-equiv="Content-Security-Policy" content="{csp}" />'
    text = text[:match.end()] + meta + text[match.end():]
    path.write_text(text, encoding="utf-8")


def replace_qr_cdn(path: Path, local_src: str) -> None:
    text = path.read_text(encoding="utf-8")
    matches = list(CDN_QR_RE.finditer(text))
    if len(matches) != 1:
        raise SystemExit(f"{path}: expected one html5-qrcode CDN script, found {len(matches)}")
    text = CDN_QR_RE.sub(f'<script src="{local_src}"></script>', text, count=1)
    path.write_text(text, encoding="utf-8")


def extract_inline_scripts(path: Path, outputs):
    text = path.read_text(encoding="utf-8")
    inline_count = 0
    out_index = 0

    def repl(match):
        nonlocal inline_count, out_index
        attrs = match.group("attrs") or ""
        body = match.group("body")
        if re.search(r"\bsrc\s*=", attrs, re.I):
            return match.group(0)
        inline_count += 1
        if out_index >= len(outputs):
            raise SystemExit(f"{path}: more inline scripts than expected")
        disk_path, html_src = outputs[out_index]
        out_index += 1
        Path(disk_path).parent.mkdir(parents=True, exist_ok=True)
        Path(disk_path).write_text(body.strip("\n") + "\n", encoding="utf-8")
        return f'<script src="{html_src}"></script>'

    text = SCRIPT_RE.sub(repl, text)
    if inline_count != len(outputs):
        raise SystemExit(f"{path}: expected {len(outputs)} inline scripts, found {inline_count}")
    path.write_text(text, encoding="utf-8")


def ensure_no_inline_script(path: Path):
    text = path.read_text(encoding="utf-8")
    inline = []
    for match in SCRIPT_RE.finditer(text):
        attrs = match.group("attrs") or ""
        if not re.search(r"\bsrc\s*=", attrs, re.I) and match.group("body").strip():
            inline.append(match.group(0)[:80])
    if inline:
        raise SystemExit(f"{path}: inline scripts remain")
    if INLINE_HANDLER_RE.search(text):
        raise SystemExit(f"{path}: inline event handler attribute found")
    if re.search(r"javascript\s*:", text, re.I):
        raise SystemExit(f"{path}: javascript: URL found")


def patch_root_sw():
    path = Path("service-worker.js")
    text = path.read_text(encoding="utf-8")
    old = 'const CACHE = "kweider-customer-v4.5.8";'
    new = 'const CACHE = "kweider-customer-v4.5.9";'
    if text.count(old) != 1:
        raise SystemExit("service-worker.js: unexpected cache version")
    text = text.replace(old, new, 1)
    marker = '  "./assets/js/app-shell.js",\n'
    additions = (
        '  "./assets/js/rewards-page.js",\n'
        '  "./assets/js/staff-page.js",\n'
        '  "./assets/js/staff-app-install.js",\n'
        '  "./assets/js/staff-app-page.js",\n'
        '  "./assets/vendor/html5-qrcode.min.js",\n'
    )
    if text.count(marker) != 1:
        raise SystemExit("service-worker.js: app-shell cache marker mismatch")
    text = text.replace(marker, marker + additions, 1)
    path.write_text(text, encoding="utf-8")


def patch_staff_sw():
    path = Path("staff-app/service-worker.js")
    text = path.read_text(encoding="utf-8")
    old = 'const CACHE = "kweider-staff-v4.4.0";'
    new = 'const CACHE = "kweider-staff-v4.4.1";'
    if text.count(old) != 1:
        raise SystemExit("staff-app/service-worker.js: unexpected cache version")
    text = text.replace(old, new, 1)
    marker = '  "../assets/js/app-shell.js"\n'
    additions = (
        ',\n'
        '  "../assets/js/staff-app-install.js",\n'
        '  "../assets/js/staff-app-page.js",\n'
        '  "../assets/vendor/html5-qrcode.min.js"\n'
    )
    if text.count(marker) != 1:
        raise SystemExit("staff-app/service-worker.js: app-shell cache marker mismatch")
    text = text.replace(marker, marker.rstrip("\n") + additions, 1)
    path.write_text(text, encoding="utf-8")


rewards = Path("rewards.html")
staff = Path("staff.html")
staff_app = Path("staff-app/index.html")

for page in (rewards, staff, staff_app):
    if not page.exists():
        raise SystemExit(f"Missing {page}")

replace_qr_cdn(staff, "assets/vendor/html5-qrcode.min.js")
replace_qr_cdn(staff_app, "../assets/vendor/html5-qrcode.min.js")

insert_csp(rewards, REWARDS_CSP)
insert_csp(staff, STAFF_CSP)
insert_csp(staff_app, STAFF_CSP)

extract_inline_scripts(
    rewards,
    [("assets/js/rewards-page.js", "assets/js/rewards-page.js")],
)
extract_inline_scripts(
    staff,
    [("assets/js/staff-page.js", "assets/js/staff-page.js")],
)
extract_inline_scripts(
    staff_app,
    [
        ("assets/js/staff-app-install.js", "../assets/js/staff-app-install.js"),
        ("assets/js/staff-app-page.js", "../assets/js/staff-app-page.js"),
    ],
)

patch_root_sw()
patch_staff_sw()

for page in (rewards, staff, staff_app):
    ensure_no_inline_script(page)

for page in (staff, staff_app):
    text = page.read_text(encoding="utf-8")
    if "cdnjs.cloudflare.com" in text:
        raise SystemExit(f"{page}: CDN reference remains")

for page in (rewards, staff, staff_app):
    text = page.read_text(encoding="utf-8")
    if text.lower().count("content-security-policy") != 1:
        raise SystemExit(f"{page}: CSP count is not exactly one")

print("CSP + local QR patch prepared successfully")
