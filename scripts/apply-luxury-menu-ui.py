from pathlib import Path
import hashlib
import re

EXPECTED_INDEX_BLOB = "65ab1ac2a8a8a82359b4fcec91bf35e773e835d3"
MARKER = "    </style>\n</head>"
START = "        /* --- KWEIDER LUXURY BEIGE MENU REFRESH — PRESENTATION ONLY --- */\n"

CSS = r'''        /* --- KWEIDER LUXURY BEIGE MENU REFRESH — PRESENTATION ONLY --- */
        :root {
            --menu-beige: #F1E7DA;
            --menu-beige-warm: #EFE3D3;
            --menu-charcoal: #171516;
            --menu-burgundy: #53131C;
            --menu-burgundy-deep: #3A0D16;
            --menu-ivory: #FAF6F0;
            --menu-gold: #C6A15B;
            --menu-gold-light: #E8D090;
        }

        html {
            background: var(--menu-beige);
        }

        body {
            background:
                radial-gradient(circle at 50% -8%, rgba(198, 161, 91, 0.10), transparent 34%),
                linear-gradient(180deg, #F4EDE3 0%, var(--menu-beige) 48%, var(--menu-beige-warm) 100%);
            background-attachment: fixed;
        }

        .hero-banner-container {
            background: transparent;
        }

        .sticky-back-btn {
            background: linear-gradient(180deg, #5E1721 0%, var(--menu-burgundy) 48%, var(--menu-burgundy-deep) 100%);
            color: var(--menu-gold-light);
            border-color: rgba(198, 161, 91, 0.82);
            box-shadow: 0 8px 22px rgba(83, 19, 28, 0.24), inset 0 1px 0 rgba(255,255,255,0.06);
        }

        .sticky-back-btn:hover {
            background: linear-gradient(180deg, #6A1A25 0%, #5A1520 50%, #421019 100%);
            color: var(--menu-ivory);
            border-color: var(--menu-gold-light);
        }

        .allergy-notice-top {
            color: #312D2A;
        }

        .allergy-notice-top .ar-text {
            color: var(--menu-burgundy);
        }

        .allergy-notice-top > div[style],
        .allergy-notice-top > div[style] .ar-text {
            color: var(--menu-charcoal) !important;
        }

        .section-title {
            color: var(--menu-charcoal);
            border-left-color: var(--menu-burgundy);
            text-shadow: none;
        }

        .item-card {
            border-color: rgba(83, 19, 28, 0.18);
            box-shadow: 0 10px 26px rgba(45, 30, 26, 0.18);
        }

        .item-card:hover {
            border-color: rgba(198, 161, 91, 0.68);
            box-shadow: 0 16px 34px rgba(45, 30, 26, 0.24);
        }

        .mini-info {
            position: relative;
            overflow: hidden;
            isolation: isolate;
            background: linear-gradient(
                to bottom,
                #6A1A25 0%,
                var(--menu-burgundy) 42%,
                #421019 74%,
                #241618 100%
            );
            border-top: 0;
        }

        .mini-info::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 2px;
            z-index: 3;
            pointer-events: none;
            background: linear-gradient(
                90deg,
                rgba(143,111,53,0.18) 0%,
                var(--menu-gold) 22%,
                #F2DDA2 50%,
                var(--menu-gold) 78%,
                rgba(143,111,53,0.18) 100%
            );
            background-size: 240% 100%;
            box-shadow: 0 0 8px rgba(198,161,91,0.28);
            animation: kweiderGoldWave 5.8s ease-in-out infinite;
        }

        .mini-name-en {
            position: relative;
            z-index: 1;
            color: var(--menu-gold-light);
            text-shadow: 0 1px 8px rgba(0,0,0,0.28);
        }

        .mini-name-ar {
            position: relative;
            z-index: 1;
            color: var(--menu-ivory);
        }

        .home-cat-text {
            background: linear-gradient(
                to bottom,
                #621922 0%,
                var(--menu-burgundy) 44%,
                #421019 76%,
                #241618 100%
            );
        }

        .home-cat-separator {
            background: linear-gradient(
                90deg,
                rgba(143,111,53,0.28) 0%,
                var(--menu-gold) 22%,
                #F2DDA2 50%,
                var(--menu-gold) 78%,
                rgba(143,111,53,0.28) 100%
            );
            background-size: 240% 100%;
            box-shadow: 0 0 8px rgba(198,161,91,0.22);
            animation: kweiderGoldWave 5.8s ease-in-out infinite;
        }

        .home-cat-en {
            color: var(--menu-gold-light);
        }

        .home-cat-ar {
            color: var(--menu-ivory);
        }

        @keyframes kweiderGoldWave {
            0% { background-position: 180% 0; }
            50% { background-position: 50% 0; }
            100% { background-position: -80% 0; }
        }

        @media (prefers-reduced-motion: reduce) {
            .mini-info::before,
            .home-cat-separator {
                animation: none;
                background-position: 50% 0;
            }
        }

        @media (max-width: 600px) {
            body { background-attachment: scroll; }
        }

'''

path = Path("index.html")
original = path.read_text(encoding="utf-8")

# Git blob SHA guard: stage must start from the exact audited live index.
data = original.encode("utf-8")
actual_blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
if actual_blob != EXPECTED_INDEX_BLOB:
    raise SystemExit(f"index.html changed before UI patch: {actual_blob}")

if original.count(MARKER) != 1:
    raise SystemExit("Expected style closing marker exactly once")
if START in original:
    raise SystemExit("Luxury menu UI block already exists")

# Snapshot all JavaScript and product data before presentation-only change.
scripts_before = re.findall(r"<script\b[^>]*>.*?</script>", original, flags=re.S | re.I)
data_attrs_before = re.findall(r"\bdata-[\w-]+=(?:\"[^\"]*\"|'[^']*')", original, flags=re.I)
prices_before = re.findall(r"£\d+(?:\.\d{1,2})?", original)
arabic_before = re.findall(r"[\u0600-\u06FF][^<>\n]*", original)

patched = original.replace(MARKER, CSS + MARKER, 1)

# Reversibility guard: removing only this CSS must restore the original byte-for-byte.
restored = patched.replace(CSS, "", 1)
if restored != original:
    raise SystemExit("Reversibility check failed")

scripts_after = re.findall(r"<script\b[^>]*>.*?</script>", patched, flags=re.S | re.I)
data_attrs_after = re.findall(r"\bdata-[\w-]+=(?:\"[^\"]*\"|'[^']*')", patched, flags=re.I)
prices_after = re.findall(r"£\d+(?:\.\d{1,2})?", patched)
arabic_after = re.findall(r"[\u0600-\u06FF][^<>\n]*", patched)

if scripts_after != scripts_before:
    raise SystemExit("JavaScript changed unexpectedly")
if data_attrs_after != data_attrs_before:
    raise SystemExit("Product/customer data attributes changed unexpectedly")
if prices_after != prices_before:
    raise SystemExit("Prices changed unexpectedly")
if arabic_after != arabic_before:
    raise SystemExit("Arabic content changed unexpectedly")

required = [
    "--menu-beige: #F1E7DA",
    "color: var(--menu-charcoal)",
    "background: linear-gradient(\n                to bottom,\n                #6A1A25",
    "animation: kweiderGoldWave 5.8s ease-in-out infinite",
    "@media (prefers-reduced-motion: reduce)",
]
for needle in required:
    if needle not in patched:
        raise SystemExit(f"Required luxury UI rule missing: {needle}")

path.write_text(patched, encoding="utf-8")
print("Luxury menu UI patch validated.")
print("JavaScript unchanged: PASS")
print("Data attributes unchanged: PASS")
print("Prices unchanged: PASS")
print("Arabic content unchanged: PASS")
print("Reversible presentation-only patch: PASS")
