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
    "sort_order"
  ].join(",");

  const SECTION_CODES = {
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
    "hot-drinks": "HD"
  };

  function money(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `£${number.toFixed(2)}` : "";
  }

  function productId(code, index) {
    return `KWD-${code}-${String(index + 1).padStart(3, "0")}`;
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

  function applyRowToCard(card, row) {
    card.dataset.productId = row.product_id;
    card.dataset.menuStatus = row.availability_status || "available";
    card.setAttribute("data-name-en", row.name_en || "");
    card.setAttribute("data-name-ar", row.name_ar || "");
    card.setAttribute("data-desc-en", row.description_en || "");
    card.setAttribute("data-desc-ar", row.description_ar || "");
    card.setAttribute("data-price", money(row.price));
    card.setAttribute("data-allergy", row.allergy_information || "Not specified in source");

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

  function createOfferCard(row) {
    const card = document.createElement("div");
    card.className = "item-card";

    const price = document.createElement("span");
    price.className = "item-price";
    card.appendChild(price);

    const img = document.createElement("img");
    img.className = "item-image";
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = row.name_en || "KWEIDER Special Offer";
    if (row.image_path) {
      img.src = row.image_path;
      card.setAttribute("data-img", row.image_path);
    }
    card.appendChild(img);

    const info = document.createElement("div");
    info.className = "mini-info";
    const nameEn = document.createElement("div");
    nameEn.className = "mini-name-en";
    const nameAr = document.createElement("div");
    nameAr.className = "mini-name-ar";
    info.append(nameEn, nameAr);
    card.appendChild(info);

    card.addEventListener("click", function () {
      if (typeof window.openDetails === "function") window.openDetails(card);
    });

    applyRowToCard(card, row);
    return card;
  }

  function ensureSpecialOffersSection(rows) {
    if (!rows.length || document.getElementById("special-offers")) return;

    const mainMenu = document.getElementById("main-menu");
    if (!mainMenu) return;

    const section = document.createElement("div");
    section.id = "special-offers";
    section.className = "menu-section";

    const back = document.createElement("button");
    back.className = "sticky-back-btn";
    back.type = "button";
    back.textContent = "← Back to Categories | العودة للتصنيفات";
    back.addEventListener("click", function () {
      if (typeof window.goHome === "function") window.goHome();
    });

    const title = document.createElement("div");
    title.className = "section-title";
    const titleEn = document.createElement("span");
    titleEn.textContent = "Kweider Special Offers";
    const titleAr = document.createElement("span");
    titleAr.className = "ar-text";
    titleAr.textContent = "عروض قويدر الخاصة";
    title.append(titleEn, titleAr);

    const grid = document.createElement("div");
    grid.className = "item-grid";
    rows.forEach(row => grid.appendChild(createOfferCard(row)));

    section.append(back, title, grid);

    const firstSection = mainMenu.querySelector(".menu-section");
    if (firstSection) mainMenu.insertBefore(section, firstSection);
    else mainMenu.appendChild(section);
  }

  function syncSection(section, rows) {
    const code = SECTION_CODES[section.id];
    if (!code) return;

    const cards = Array.from(section.querySelectorAll(".item-card"));
    if (!cards.length) return;

    const byId = new Map(rows.map(row => [row.product_id, row]));

    cards.forEach((card, index) => {
      const expectedId = productId(code, index);
      card.dataset.productId = expectedId;
      const row = byId.get(expectedId);
      if (!row) {
        console.warn(`KWEIDER menu sync missing database row for ${expectedId}`);
        return;
      }
      applyRowToCard(card, row);
    });

    if (cards.length !== rows.length) {
      console.warn(
        `KWEIDER menu sync count mismatch for ${section.id}: static=${cards.length}, database=${rows.length}`
      );
    }
  }

  async function loadPublishedMenu() {
    const query = new URLSearchParams({
      select: SELECT_FIELDS,
      order: "category_code.asc,sort_order.asc,product_id.asc"
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/kweider_menu_items?${query.toString()}`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        Accept: "application/json"
      },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Menu data request failed (${response.status})`);
    return response.json();
  }

  async function syncMenu() {
    try {
      ensureStyles();
      const rows = await loadPublishedMenu();
      if (!Array.isArray(rows) || !rows.length) throw new Error("Published menu table returned no items.");

      const grouped = new Map();
      for (const row of rows) {
        if (!grouped.has(row.category_code)) grouped.set(row.category_code, []);
        grouped.get(row.category_code).push(row);
      }

      ensureSpecialOffersSection(grouped.get("SO") || []);

      document.querySelectorAll(".menu-section").forEach(section => {
        const code = SECTION_CODES[section.id];
        if (!code) return;
        syncSection(section, grouped.get(code) || []);
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
