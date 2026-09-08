from pathlib import Path
import hashlib
import json
import re

EXPECTED_INDEX_BLOB = "7202770a267829f86a7b66863d555766c97bc807"

NEW_SCHEMA = {
    "@context": "https://schema.org",
    "@type": ["Restaurant", "Bakery", "CafeOrCoffeeShop"],
    "@id": "https://kweidersweets.co.uk/#kweider-acton",
    "name": "Kweider Sweets",
    "alternateName": [
        "قويدر للحلويات الشرقية",
        "حلويات قويدر"
    ],
    "description": "Kweider Sweets is a Damascene Syrian sweets, bakery and cafe in Acton, West London, inspired by the culinary heritage of Damascus and the Levant. Serving authentic Syrian breakfast, kunafa, knafeh, baklava, maamoul, Arabic ice cream, Arabic coffee and handcrafted desserts.",
    "keywords": [
        "Syrian sweets London",
        "Damascene sweets London",
        "Damascus sweets London",
        "Levantine sweets London",
        "Arabic sweets London",
        "Middle Eastern sweets London",
        "Syrian desserts London",
        "Damascene desserts London",
        "Kunafa London",
        "Knafeh London",
        "Baklava London",
        "Maamoul London",
        "Syrian breakfast London",
        "Arabic coffee London",
        "Acton cafe",
        "West London sweets"
    ],
    "url": "https://kweidersweets.co.uk/",
    "menu": "https://menu.kweidersweets.co.uk/",
    "hasMenu": "https://menu.kweidersweets.co.uk/",
    "logo": "https://menu.kweidersweets.co.uk/logo.webp",
    "image": "https://menu.kweidersweets.co.uk/logo.webp",
    "telephone": "+447440444500",
    "foundingDate": "1969",
    "servesCuisine": [
        "Syrian",
        "Levantine",
        "Damascene",
        "Middle Eastern"
    ],
    "areaServed": [
        "Acton",
        "West London",
        "London"
    ],
    "address": {
        "@type": "PostalAddress",
        "streetAddress": "184-186 High Street",
        "addressLocality": "Acton",
        "addressRegion": "London",
        "postalCode": "W3 9NH",
        "addressCountry": "GB"
    },
    "sameAs": [
        "https://www.instagram.com/kweideruk",
        "https://www.facebook.com/KweiderUK",
        "https://www.tiktok.com/@kweideruk"
    ]
}

path = Path("index.html")
text = path.read_text(encoding="utf-8")
blob_data = text.encode("utf-8")
actual_blob = hashlib.sha1(b"blob " + str(len(blob_data)).encode() + b"\0" + blob_data).hexdigest()
if actual_blob != EXPECTED_INDEX_BLOB:
    raise SystemExit(f"index.html changed unexpectedly before SEO patch: {actual_blob}")

pattern = re.compile(r'<script type="application/ld\+json">\s*(\{.*?\})\s*</script>', re.S)
matches = list(pattern.finditer(text))
if len(matches) != 1:
    raise SystemExit(f"Expected exactly one JSON-LD block, found {len(matches)}")

match = matches[0]
old_json_text = match.group(1)
old_schema = json.loads(old_json_text)

# Guard the audited baseline entity before replacing it.
if old_schema.get("@type") != "Restaurant":
    raise SystemExit("Unexpected existing schema @type")
if old_schema.get("name") != "Kweider Sweets":
    raise SystemExit("Unexpected existing business name")
if old_schema.get("address", {}).get("postalCode") != "W3 9NH":
    raise SystemExit("Unexpected existing postcode")

new_json_text = json.dumps(NEW_SCHEMA, ensure_ascii=False, indent=2)
json.loads(new_json_text)  # syntax validation
new_block = f'<script type="application/ld+json">\n{new_json_text}\n</script>'
patched = text[:match.start()] + new_block + text[match.end():]

# Strong scope guard: removing the new block and restoring the old block must
# recover the original file byte-for-byte.
restored = patched[:match.start()] + match.group(0) + patched[match.start() + len(new_block):]
if restored != text:
    raise SystemExit("Scope check failed: content outside JSON-LD would change")

# Required semantic checks.
required_types = {"Restaurant", "Bakery", "CafeOrCoffeeShop"}
if set(NEW_SCHEMA["@type"]) != required_types:
    raise SystemExit("Local business type set is incomplete")
if "قويدر للحلويات الشرقية" not in NEW_SCHEMA["alternateName"]:
    raise SystemExit("Arabic approved business name missing")
for term in ("Syrian", "Levantine", "Damascene", "Middle Eastern"):
    if term not in NEW_SCHEMA["servesCuisine"]:
        raise SystemExit(f"Missing cuisine identity term: {term}")
for term in ("Damascus", "London", "Acton"):
    combined = json.dumps(NEW_SCHEMA, ensure_ascii=False)
    if term not in combined:
        raise SystemExit(f"Missing local/entity term: {term}")
if NEW_SCHEMA["menu"] != NEW_SCHEMA["hasMenu"]:
    raise SystemExit("menu and hasMenu URLs must match")
if NEW_SCHEMA["telephone"] != "+447440444500":
    raise SystemExit("Telephone mismatch")

path.write_text(patched, encoding="utf-8")
print("Local SEO JSON-LD patch validated.")
print("Only JSON-LD changed: PASS")
print("Arabic alternate name: PASS")
print("Local London/Acton identity: PASS")
print("Syrian/Levantine/Damascene identity: PASS")
print("menu + hasMenu compatibility: PASS")
