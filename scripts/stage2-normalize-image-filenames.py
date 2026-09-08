from pathlib import Path
import re
import subprocess
import sys

EXPECTED_INDEX_BLOB = "257058af877729a27f7b86a97e8c35274fe237dc"

MAPPING = {
    "1KG Almond Harisa.webp": "1kg-almond-harisa.webp",
    "1KG Cream Baklava.webp": "1kg-cream-baklava.webp",
    "2 Serving Selection.webp": "2-serving-selection.webp",
    "Apricot Jam.webp": "apricot-jam.webp",
    "Authentic White Cheese.webp": "authentic-white-cheese.webp",
    "Berry Jam.webp": "berry-jam.webp",
    "Bitter Orange Jam.webp": "bitter-orange-jam.webp",
    "Black Olives.webp": "black-olives.webp",
    "Butter Creamy.webp": "butter-creamy.webp",
    "Chef’s Selection2.webp": "chefs-selection-2.webp",
    "‏‏Chef’s Selection2 - عرض .webp": "chefs-selection-offer.webp",
    "Chef’s Selection.webp": "chefs-selection.webp",
    "Citron Jam.webp": "citron-jam.webp",
    "Classic Kunafa & Coffee Combo.webp": "classic-kunafa-coffee-combo.webp",
    "coming soon.webp": "coming-soon.webp",
    "Damascus Heritage Dinner3.webp": "damascus-heritage-dinner-3.webp",
    "Emperor.webp": "emperor.webp",
    "Falafel.webp": "falafel.webp",
    "Green Olives.webp": "green-olives.webp",
    "Halloumi.webp": "halloumi.webp",
    "Kishta Rahat Delight.webp": "kishta-rahat-delight.webp",
    "Kunafa with Cream2.webp": "kunafa-with-cream-2.webp",
    "Meat Burek2.webp": "meat-burek-2.webp",
    "Meat Burek.webp": "meat-burek.webp",
    "Meat Kibbeh 2.webp": "meat-kibbeh-2.webp",
    "milkshake2026.webp": "milkshake-2026.webp",
    "Mix Pickles.webp": "mix-pickles.webp",
    "mojito lemonade .webp": "mojito-lemonade.webp",
    "mojito red bull5).webp": "mojito-red-bull-5.webp",
    "mojito strawberry .webp": "mojito-strawberry.webp",
    "nutsbaklava.webp": "nuts-baklava.webp",
    "Nuts Fatteh.webp": "nuts-fatteh.webp",
    "Olive Oil Foul.webp": "olive-oil-foul.webp",
    "Olive Oil Labneh.webp": "olive-oil-labneh.webp",
    "Olive Oil Tesqiyeh.webp": "olive-oil-tesqiyeh.webp",
    "Omelette.webp": "omelette.webp",
    "Ouzi with Meat & Nuts11.webp": "ouzi-with-meat-nuts-11.webp",
    "Ouzi with Meat & Nuts2.webp": "ouzi-with-meat-nuts-2.webp",
    "Passion Mojito.webp": "passion-mojito.webp",
    "pistachiobaklava.webp": "pistachio-baklava.webp",
    "Pistachio Kunafa2.webp": "pistachio-kunafa-2.webp",
    "Shallal Cheese.webp": "shallal-cheese.webp",
    "Single‑Serving Selection.webp": "single-serving-selection.webp",
    "Stuffed Vine Leaves  .webp": "stuffed-vine-leaves.webp",
    "Syrian ice cream milkshake.webp": "syrian-ice-cream-milkshake.webp",
    "Tahini Halawa.webp": "tahini-halawa.webp",
    "Tahini Musabaha.webp": "tahini-musabaha.webp",
    "Vegetable Mix.webp": "vegetable-mix.webp",
    "Walnut Makdous.webp": "walnut-makdous.webp",
    "Yogurt Foul.webp": "yogurt-foul.webp",
    "Zaatar.webp": "zaatar.webp",
}

EXPECTED_BLOBS = {
    "1KG Almond Harisa.webp": "8e078fe873d15e5138280c1cc23b58d506ec0883",
    "1KG Cream Baklava.webp": "ac0b69a9a4172a624e710209a8e39055fe04751e",
    "2 Serving Selection.webp": "70f1ac9685933581d4b02e4b8d5dd90250cb7c4b",
    "Apricot Jam.webp": "56f5a907fa2d4e0f687bad0800c9384bc852255e",
    "Authentic White Cheese.webp": "b54bb5a45a707589749633743bfcd7d70e84c832",
    "Berry Jam.webp": "a7f034477d2f98e09de602c61321cf3a4f61d21a",
    "Bitter Orange Jam.webp": "36aa3e890ad68b721dc247a0f5ba798d6098f4da",
    "Black Olives.webp": "24755a2d5de1c0bcd9912246bec69f7a1c9ec5b0",
    "Butter Creamy.webp": "3931fb9582fe62f06871cb34378da405401bf0b6",
    "Chef’s Selection2.webp": "60e17ac783e40993ca024df031114626066b7eda",
    "‏‏Chef’s Selection2 - عرض .webp": "60e17ac783e40993ca024df031114626066b7eda",
    "Chef’s Selection.webp": "a1921ded05b5a2d0a6ca3e690dc306d84e27e178",
    "Citron Jam.webp": "c646683164d0097d68106fc35f79da80a6de5445",
    "Classic Kunafa & Coffee Combo.webp": "bb7b1ad51c79f63e2940381ae5d5f885e02e140b",
    "coming soon.webp": "fdb1603cea87a17fc646adeafc3f0d4c09218348",
    "Damascus Heritage Dinner3.webp": "92237fab3f5f2b05758601a56d6047b32b8dbe16",
    "Emperor.webp": "3ecc76de519ef05da6852bfe06680184f1768564",
    "Falafel.webp": "a68358e927d9ac17e26bf5ad98b6acfbb5b8aa75",
    "Green Olives.webp": "a90122bdc0b2a383543b991f454c90cf13c82bc5",
    "Halloumi.webp": "0ac65f867157d5c9fd65522f7ea8f79c60fb42fe",
    "Kishta Rahat Delight.webp": "ff1d825c53ad31a37f5c102bb350281a65c32d21",
    "Kunafa with Cream2.webp": "58207a00fb7ad789914ebfc9351c28a50c48b02c",
    "Meat Burek2.webp": "d8608e337150d232c5220df042b5a3ea5f664f12",
    "Meat Burek.webp": "9ee535c23f6f692f29831818f50a42040004b295",
    "Meat Kibbeh 2.webp": "3d33519b4f70e25c7490a40b3aa516ce697f024b",
    "milkshake2026.webp": "522a6ddfacfe003a5393327d0209d2d53472bf49",
    "Mix Pickles.webp": "dd9588d90cb0b454eea75ab47aa8de6b750ec9c4",
    "mojito lemonade .webp": "3885383a4502d3f0a7705e0958f284851e79d90a",
    "mojito red bull5).webp": "df03d20a107150aa7684308bb5ead259752dd2de",
    "mojito strawberry .webp": "18a9fd3a22789c763c564c26cc8aac359188dbc3",
    "nutsbaklava.webp": "61a9a2eb1f6b74b7a0fa2df017d51718ad63f42b",
    "Nuts Fatteh.webp": "08e050dfcfd87e2e0929d58dc3565106cc92b7db",
    "Olive Oil Foul.webp": "395f24d98e0ad8fb2dc6ca1aee52bd54c0286ee4",
    "Olive Oil Labneh.webp": "0a7572b8f3561122780648f295039dd99572d1ed",
    "Olive Oil Tesqiyeh.webp": "15ce66cb9de6e517cdd02abdbf88b2fc8d52d074",
    "Omelette.webp": "366a1db5c1ed6bebb3efa2f9d48782385ab9ef18",
    "Ouzi with Meat & Nuts11.webp": "973d6be79870083f95e8776c7bb662b9b7682b33",
    "Ouzi with Meat & Nuts2.webp": "3814cb5a7ff5cd04cbcd2163f012135a3e4436ab",
    "Passion Mojito.webp": "a26327de83c01bd1f54ef46bf1052d172020d879",
    "pistachiobaklava.webp": "e4fe1d71729452e528f009570215d865da2d5687",
    "Pistachio Kunafa2.webp": "e750e947e22c99664b98ba9ec5c3bab58e8620c8",
    "Shallal Cheese.webp": "a3c500ebce1f5d1c2cae91eca63020b922eaf2a6",
    "Single‑Serving Selection.webp": "4167ae3a8cba6864565ac97438472a3cddd4240e",
    "Stuffed Vine Leaves  .webp": "748f850530e82229477b6aca595c94a350049499",
    "Syrian ice cream milkshake.webp": "a160fb9b709dafec5b70ce02b38bd60e17846c92",
    "Tahini Halawa.webp": "45b820bbd32041262e97601bf5e211e01cc8064f",
    "Tahini Musabaha.webp": "93e1eaa22c88440b759525c48f8adf1fd19b66b6",
    "Vegetable Mix.webp": "e6a4574a840873dc34adf953b90897428d5e1275",
    "Walnut Makdous.webp": "e8ea3518389c4f42997afedc119ef56c16df2c5a",
    "Yogurt Foul.webp": "54c4f0ded55a504150211a5753bbd45ba597d465",
    "Zaatar.webp": "dd5d10f4e7cc869e9a1768a90a4c89d201152307",
}

CLEAN_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*\.webp$")
ATTR_TEMPLATE = r"(?P<prefix>\b(?:src|data-img)\s*=\s*['\"]){}(?P<suffix>['\"])"


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def fail(message):
    raise SystemExit(message)


index = Path("index.html")
if not index.exists():
    fail("index.html is missing")

actual_index_blob = run("git", "hash-object", "index.html")
if actual_index_blob != EXPECTED_INDEX_BLOB:
    fail(f"index.html changed unexpectedly before stage 2: {actual_index_blob}")

if len(MAPPING) != 51 or len(set(MAPPING.values())) != 51:
    fail("Image rename mapping count/collision check failed")

for old, new in MAPPING.items():
    if not CLEAN_NAME.fullmatch(new):
        fail(f"Target filename is not clean: {new}")
    src = Path(old)
    dst = Path(new)
    if not src.is_file():
        fail(f"Missing source image: {old!r}")
    if dst.exists():
        fail(f"Target already exists: {new!r}")
    actual_blob = run("git", "hash-object", "--", old)
    expected_blob = EXPECTED_BLOBS[old]
    if actual_blob != expected_blob:
        fail(f"Source blob changed for {old!r}: {actual_blob} != {expected_blob}")

# Make sure no old filename is used by another tracked text file.
tracked = run("git", "ls-files").splitlines()
for old in MAPPING:
    offenders = []
    needle = old.encode("utf-8")
    for name in tracked:
        if name == "index.html" or name in {"scripts/stage2-normalize-image-filenames.py", ".github/workflows/stage2-normalize-image-filenames.yml"}:
            continue
        p = Path(name)
        if not p.is_file():
            continue
        data = p.read_bytes()
        if b"\x00" in data:
            continue
        if needle in data:
            offenders.append(name)
    if offenders:
        fail(f"Old filename {old!r} is referenced outside index.html: {offenders}")

original = index.read_text(encoding="utf-8")
patched = original
replacement_counts = {}

for old, new in MAPPING.items():
    pattern = re.compile(ATTR_TEMPLATE.format(re.escape(old)))
    patched, count = pattern.subn(lambda m: f"{m.group('prefix')}{new}{m.group('suffix')}", patched)
    if count < 1:
        fail(f"No src/data-img reference found for {old!r}")
    replacement_counts[old] = count

# Strong invariant: reversing only filename changes must restore the original index byte-for-byte.
restored = patched
for old, new in MAPPING.items():
    pattern = re.compile(ATTR_TEMPLATE.format(re.escape(new)))
    restored = pattern.sub(lambda m: f"{m.group('prefix')}{old}{m.group('suffix')}", restored)
if restored != original:
    fail("Index identity check failed: something besides image filenames changed")

index.write_text(patched, encoding="utf-8")

for old, new in MAPPING.items():
    subprocess.check_call(["git", "mv", "--", old, new])
    new_blob = run("git", "hash-object", "--", new)
    if new_blob != EXPECTED_BLOBS[old]:
        fail(f"Visual identity check failed: blob changed while renaming {old!r}")

# Verify every local webp src/data-img in the COMPLETE current index exists exactly.
final_text = index.read_text(encoding="utf-8")
refs = re.findall(r"\b(?:src|data-img)\s*=\s*['\"]([^'\"]+\.webp)['\"]", final_text, flags=re.I)
missing = []
for ref in refs:
    if ref.startswith(("http://", "https://", "//", "data:")):
        continue
    if not Path(ref).is_file():
        missing.append(ref)
if missing:
    fail(f"Broken local WEBP references after rename: {sorted(set(missing))}")

for old in MAPPING:
    pattern = re.compile(ATTR_TEMPLATE.format(re.escape(old)))
    if pattern.search(final_text):
        fail(f"Old filename still referenced in index.html: {old!r}")

for new in MAPPING.values():
    if not Path(new).is_file():
        fail(f"Renamed image missing: {new!r}")

print(f"Validated and renamed {len(MAPPING)} images.")
print(f"Updated {sum(replacement_counts.values())} src/data-img references only.")
print("Index reverse-identity check: PASS")
print("All local WEBP references exist: PASS")
print("All image blobs preserved: PASS")
