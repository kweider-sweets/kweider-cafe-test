(function () {
  "use strict";

  if (!document.getElementById("main-menu")) return;

  const SUPABASE_URL = "https://fwjiceleybxhgetsvsvp.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_yNgSShCyeQ6FfSy30T6-hg_9dLXXpwk";
  const SELECT_FIELDS = [
    "product_id",
    "category_code",
    "category_name",
    "name_en",
    "name_ar",
    "price",
    "description_en",
    "description_ar",
    "allergy_information",
    "image_path",
    "availability_status",
    "is_new",
    "sort_order",
  ].join(",");

  const FALLBACK_SECTION_CODES = {
    "special-offers": "SO",
    breakfast: "BF",
    dinner: "DN",
    kunafa: "KF",
    "premium-sweets": "PS",
    "cake-eclair": "CE",
    "milk-cheesecake": "MC",
    "fruits-dubai": "FD",
    "ice-cream": "IC",
    "cold-drinks": "CD",
    "hot-drinks": "HD",
  };

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&amp;/g, "&")
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
      .trim();
  }

  function money(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `£${number.toFixed(2)}` : "";
  }

  function ensureStyles() {
    if (document.getElementById("kweider-menu-db-sync-styles")) return;
    const style = document.createElement("style");
    style.id = "kweider-menu-db-sync-styles";
    style.textContent = `
      .item-card[data-menu-status="hidden"] { display: none !important; }
      .item-card[data-menu-status="sold_out"] { cursor: default; }
      .menu-db-soldout {
        position: absolute;
        inset: 0;
        z-index: 30;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,.62);
        pointer-events: none;
      }
      .menu-db-soldout span {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 9px 15px;
        border-radius: 999px;
        border: 1px solid var(--gold-primary, #C5A059);
        background: rgba(83,19,28,.96);
        color: #fff;
        font-weight: 900;
        font-size: 14px;
        line-height: 1.2;
        text-align: center;
        box-shadow: 0 4px 18px rgba(0,0,0,.55);
      }
    `;
    document.head.appendChild(style);
  }

  function groupRows(rows) {
    const byCode = new Map();
    const byName = new Map();
    for (const row of rows) {
      if (!byCode.has(row.category_code)) byCode.set(row.category_code, []);
      byCode.get(row.category_code).push(row);
      byName.set(normalize(row.category_name), row.category_code);
    }
    for (const group of byCode.values()) {
      group.sort((a, b) => {
        const orderA = Number(a.sort_order || 0);
        const orderB = Number(b.sort_order || 0);
        return orderA - orderB || String(a.product_id).localeCompare(String(b.product_id));
      });
    }
    return { byCode, byName };
  }

  function resolveSectionCode(section, grouped) {
    const fallback = FALLBACK_SECTION_CODES[section.id];
    if (fallback && grouped.byCode.has(fallback)) return fallback;

    const heading = normalize(section.querySelector(".section-title")?.textContent || "");
    if (!heading) return null;

    for (const [categoryName, code] of grouped.byName.entries()) {
      if (heading.includes(categoryName) || categoryName.includes(heading)) return code;
    }
    return null;
  }

  function applyRowToCard(card, row) {
    card.dataset.productId = row.product_id;
    card.dataset.menuStatus = row.availability_status || "available";
    card.setAttribute("data-name-en", row.name_en || "");
    card.setAttribute("data-name-ar", row.name_ar || "");
    card.setAttribute("data-desc-en", row.description_en || "");
    card.setAttribute("data-desc-ar", row.description_ar || "");
    card.setAttribute("data-price", money(row.price));
    card.setAttribute("data-allergy", row.allergy_information || "Not specified in source");

    if (row.image_path) {
      card.setAttribute("data-img", row.image_path);
      const img = card.querySelector(".item-image");
      if (img && img.getAttribute("src") !== row.image_path) img.setAttribute("src", row.image_path);
    }

    const nameEn = card.querySelector(".mini-name-en");
    const nameAr = card.querySelector(".mini-name-ar");
    const price = card.querySelector(".item-price");
    if (nameEn) nameEn.textContent = row.name_en || "";
    if (nameAr) nameAr.textContent = row.name_ar || "";
    if (price) price.textContent = money(row.price);

    card.classList.toggle("is-new", Boolean(row.is_new));

    const oldOverlay = card.querySelector(".menu-db-soldout");
    if (oldOverlay) oldOverlay.remove();

    if (row.availability_status === "hidden") {
      card.hidden = true;
      return;
    }

    card.hidden = false;
    if (row.availability_status === "sold_out") {
      const overlay = document.createElement("div");
      overlay.className = "menu-db-soldout";
      overlay.setAttribute("aria-label", "Sold Out | نفد حالياً");
      overlay.innerHTML = "<span>Sold Out | نفد حالياً</span>";
      card.appendChild(overlay);
    }
  }

  function syncSection(section, rows) {
    const cards = Array.from(section.querySelectorAll(".item-card"));
    if (!cards.length || !rows.length) return;

    const unused = new Set(rows.map((_, index) => index));
    const byCurrentName = new Map();
    rows.forEach((row, index) => {
      const key = normalize(row.name_en);
      if (!byCurrentName.has(key)) byCurrentName.set(key, []);
      byCurrentName.get(key).push(index);
    });

    cards.forEach((card, cardIndex) => {
      const currentName = normalize(card.getAttribute("data-name-en"));
      let rowIndex = null;
      const candidates = byCurrentName.get(currentName) || [];
      rowIndex = candidates.find((index) => unused.has(index));

      if (rowIndex == null) {
        rowIndex = Array.from(unused).sort((a, b) => a - b)[0];
      }
      if (rowIndex == null) return;

      unused.delete(rowIndex);
      applyRowToCard(card, rows[rowIndex]);
    });

    if (cards.length !== rows.length) {
      console.warn(
        `KWEIDER menu sync count mismatch for ${section.id}: static=${cards.length}, database=${rows.length}`,
      );
    }
  }

  async function loadPublishedMenu() {
    const query = new URLSearchParams({
      select: SELECT_FIELDS,
      order: "category_code.asc,sort_order.asc,product_id.asc",
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/kweider_menu_items?${query.toString()}`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Menu data request failed (${response.status})`);
    return response.json();
  }

  async function syncMenu() {
    try {
      ensureStyles();
      const rows = await loadPublishedMenu();
      if (!Array.isArray(rows) || !rows.length) throw new Error("Published menu table returned no items.");

      const grouped = groupRows(rows);
      document.querySelectorAll(".menu-section").forEach((section) => {
        const code = resolveSectionCode(section, grouped);
        if (!code) return;
        const group = grouped.byCode.get(code) || [];
        syncSection(section, group);
      });

      document.documentElement.dataset.menuDataSource = "supabase-published";
      window.dispatchEvent(new CustomEvent("kweider-menu-data-synced", { detail: { count: rows.length } }));
    } catch (error) {
      document.documentElement.dataset.menuDataSource = "static-fallback";
      console.error("KWEIDER menu data sync failed; keeping static menu unchanged:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncMenu, { once: true });
  } else {
    void syncMenu();
  }
})();
