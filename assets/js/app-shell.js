(function () {
  "use strict";
  let deferredPrompt = null;
  const installButtons = () => document.querySelectorAll("[data-install-app]");

  if (document.getElementById("main-menu")) {
    const menuContrastFix = document.createElement("link");
    menuContrastFix.rel = "stylesheet";
    menuContrastFix.href = "assets/css/menu-text-contrast-fix.css?v=20260928-burgundy";
    document.head.appendChild(menuContrastFix);

    const menuLuxuryPanels = document.createElement("link");
    menuLuxuryPanels.rel = "stylesheet";
    menuLuxuryPanels.href = "assets/css/menu-luxury-panels.css?v=20260928-burgundy";
    document.head.appendChild(menuLuxuryPanels);

    const menuDataSync = document.createElement("script");
    menuDataSync.src = "assets/js/menu-data-sync.js?v=20261014-image-order-sync";
    menuDataSync.defer = true;
    document.head.appendChild(menuDataSync);
  }

  if (window.location.pathname.endsWith("/rewards.html") || window.location.pathname.endsWith("rewards.html")) {
    const hotfix = document.createElement("script");
    hotfix.src = "assets/js/rewards-turnstile-hotfix.js?v=20260909";
    hotfix.defer = true;
    document.head.appendChild(hotfix);
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installButtons().forEach((b) => (b.style.display = "inline-flex"));
    const t = document.getElementById("installToast");
    if (t) t.classList.remove("hidden");
  });
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-install-app]");
    if (!btn) return;
    if (!deferredPrompt) {
      alert(
        "On iPhone: tap Share, then “Add to Home Screen”.\nعلى الآيفون: اضغط مشاركة ثم إضافة إلى الشاشة الرئيسية.",
      );
      return;
    }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installButtons().forEach((b) => (b.style.display = "none"));
    const t = document.getElementById("installToast");
    if (t) t.classList.add("hidden");
  });

  if ("serviceWorker" in navigator) {
    const isMainMenuPage = () => {
      const path = window.location.pathname.replace(/\/+$/, "");
      return path === "" || path === "/index.html";
    };

    let registration = null;
    let controllerReloaded = false;

    const requestUpdate = () => {
      if (!registration) return;
      registration.update().catch(() => {});
    };

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!isMainMenuPage() || controllerReloaded) return;
      controllerReloaded = true;
      window.location.reload();
    });

    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./service-worker.js", { updateViaCache: "none" })
        .then((reg) => {
          registration = reg;
          requestUpdate();
        })
        .catch(console.error);
    });

    window.addEventListener("focus", requestUpdate);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") requestUpdate();
    });
  }

  function updateRewardsBannerCopy() {
    const copy = document.querySelector(".rewards-home-banner small");
    if (!copy) return;

    const en = document.createElement("span");
    en.className = "reward-copy-en";
    en.textContent = "Earn points on every visit";

    const ar = document.createElement("span");
    ar.className = "reward-copy-ar";
    ar.lang = "ar";
    ar.dir = "rtl";
    ar.textContent = "اجمع النقاط مع كل زيارة";

    copy.replaceChildren(en, ar);
  }

  function updateHomeBadge() {
    const el = document.querySelector("[data-rewards-chip]");
    if (!el) return;
    const hasSavedCard = Boolean(
      localStorage.getItem("kweiderRewards.memberToken.v1"),
    );

    const en = document.createElement("span");
    en.className = "reward-chip-en";
    en.textContent = hasSavedCard ? "My rewards" : "Join now";

    const ar = document.createElement("span");
    ar.className = "reward-chip-ar";
    ar.lang = "ar";
    ar.dir = "rtl";
    ar.textContent = hasSavedCard ? "مكافآتي" : "سجّل الآن";

    el.replaceChildren(en, ar);
  }

  function addHomeHubStyles() {
    if (document.getElementById("kweider-home-hub-styles")) return;
    const style = document.createElement("style");
    style.id = "kweider-home-hub-styles";
    style.textContent = `
      .kweider-home-hub {
        max-width: 500px;
        margin: 0 auto 12px;
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        overflow: hidden;
        border: 1px solid rgba(198, 161, 91, 0.72);
        border-radius: 15px;
        background: linear-gradient(180deg, #6a1a25 0%, #53131c 48%, #3b0d16 100%);
        box-shadow: 0 8px 22px rgba(83, 19, 28, 0.24), inset 0 1px 0 rgba(255,255,255,0.05);
      }
      .kweider-home-action {
        min-width: 0;
        min-height: 72px;
        border: 0;
        border-right: 1px solid rgba(198, 161, 91, 0.3);
        background: transparent;
        color: #faf6f0;
        text-decoration: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        padding: 8px 3px;
        cursor: pointer;
        font-family: 'Cairo', sans-serif;
        transition: background 0.2s ease, transform 0.2s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .kweider-home-action:last-child { border-right: 0; }
      .kweider-home-action:hover,
      .kweider-home-action:focus-visible {
        background: rgba(198, 161, 91, 0.12);
        outline: none;
      }
      .kweider-home-action:active { transform: scale(0.97); }
      .kweider-home-action-icon {
        width: 23px;
        height: 23px;
        display: grid;
        place-items: center;
        color: #e8d090;
        font-size: 20px;
        line-height: 1;
      }
      .kweider-home-action-en {
        color: #f2dda2;
        font-size: 10px;
        font-weight: 800;
        line-height: 1.1;
        white-space: nowrap;
      }
      .kweider-home-action-ar {
        color: #faf6f0;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 10px;
        font-weight: 700;
        line-height: 1.15;
        white-space: nowrap;
      }
      .kweider-menu-homebar {
        display: none;
        max-width: 500px;
        margin: 0 auto 14px;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .kweider-menu-homebar button {
        appearance: none;
        border: 1px solid rgba(198, 161, 91, 0.78);
        border-radius: 24px;
        padding: 9px 15px;
        background: linear-gradient(180deg, #5e1721 0%, #53131c 55%, #3b0d16 100%);
        color: #f2dda2;
        font: 800 12px 'Cairo', sans-serif;
        cursor: pointer;
      }
      .kweider-menu-homebar span {
        color: #53131c;
        font: 800 14px 'Cairo', sans-serif;
        text-align: right;
      }
      .kweider-rewards-home-link {
        position: fixed;
        top: max(14px, env(safe-area-inset-top));
        left: 14px;
        z-index: 10000;
        border: 1px solid rgba(198, 161, 91, 0.78);
        border-radius: 24px;
        padding: 8px 12px;
        background: rgba(83, 19, 28, 0.96);
        color: #f2dda2;
        text-decoration: none;
        font: 800 12px 'Cairo', sans-serif;
        box-shadow: 0 6px 18px rgba(0,0,0,0.22);
      }
      @media (max-width: 390px) {
        .kweider-home-action { min-height: 66px; padding-inline: 1px; }
        .kweider-home-action-en, .kweider-home-action-ar { font-size: 9px; }
        .kweider-home-action-icon { font-size: 18px; }
      }
    `;
    document.head.appendChild(style);
  }

  function createHubAction({ labelEn, labelAr, icon, href, action, external, aria }) {
    const el = href ? document.createElement("a") : document.createElement("button");
    el.className = "kweider-home-action";
    if (!href) el.type = "button";
    if (href) el.href = href;
    if (external) {
      el.target = "_blank";
      el.rel = "noopener noreferrer";
    }
    if (action) el.addEventListener("click", action);
    el.setAttribute("aria-label", aria || `${labelEn} - ${labelAr}`);

    const iconEl = document.createElement("span");
    iconEl.className = "kweider-home-action-icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = icon;

    const en = document.createElement("span");
    en.className = "kweider-home-action-en";
    en.textContent = labelEn;

    const ar = document.createElement("span");
    ar.className = "kweider-home-action-ar";
    ar.lang = "ar";
    ar.dir = "rtl";
    ar.textContent = labelAr;

    el.append(iconEl, en, ar);
    return el;
  }

  function setupHomeHub() {
    const mainMenu = document.getElementById("main-menu");
    const hero = document.getElementById("hero-banner-main");
    const homeMenu = document.getElementById("home-menu");
    if (!mainMenu || !hero || !homeMenu) return;

    addHomeHubStyles();

    const originalRewardsBanner = hero.querySelector(".rewards-home-banner");
    if (originalRewardsBanner) originalRewardsBanner.style.display = "none";

    let hub = document.getElementById("kweider-home-hub");
    if (!hub) {
      hub = document.createElement("nav");
      hub.id = "kweider-home-hub";
      hub.className = "kweider-home-hub";
      hub.setAttribute("aria-label", "Kweider quick access");

      const pickup = createHubAction({
        labelEn: "Pickup",
        labelAr: "استلام محلي",
        icon: "▣",
        href: "https://kweidersweets.co.uk/collections/fresh-sweets-local-pickup-only",
        external: true,
        aria: "Fresh sweets local pickup",
      });
      const website = createHubAction({
        labelEn: "Website",
        labelAr: "الموقع",
        icon: "◎",
        href: "https://kweidersweets.co.uk/",
        external: true,
        aria: "Open Kweider website",
      });
      const offers = createHubAction({
        labelEn: "Offers",
        labelAr: "عروضنا",
        icon: "✦",
        action: () => window.openCategory && window.openCategory("special-offers"),
      });
      const rewards = createHubAction({
        labelEn: "Rewards",
        labelAr: "مكافآتي",
        icon: "★",
        href: "rewards.html",
      });
      const menu = createHubAction({
        labelEn: "Menu",
        labelAr: "المنيو",
        icon: "☰",
        action: () => window.showMenuCategories && window.showMenuCategories(),
      });

      hub.append(pickup, website, offers, rewards, menu);
      hero.prepend(hub);
    }

    let menuHomeBar = document.getElementById("kweider-menu-homebar");
    if (!menuHomeBar) {
      menuHomeBar = document.createElement("div");
      menuHomeBar.id = "kweider-menu-homebar";
      menuHomeBar.className = "kweider-menu-homebar";

      const homeButton = document.createElement("button");
      homeButton.type = "button";
      homeButton.textContent = "← Home | الرئيسية";
      homeButton.addEventListener("click", () => window.goHome && window.goHome());

      const title = document.createElement("span");
      title.textContent = "Dine-In Menu | المنيو";

      menuHomeBar.append(homeButton, title);
      mainMenu.insertBefore(menuHomeBar, homeMenu);
    }

    const originalOpenCategory = window.openCategory;
    if (typeof originalOpenCategory === "function" && !originalOpenCategory.__kweiderHomeHubWrapped) {
      const wrappedOpenCategory = function (categoryId) {
        if (menuHomeBar) menuHomeBar.style.display = "none";
        originalOpenCategory(categoryId);
      };
      wrappedOpenCategory.__kweiderHomeHubWrapped = true;
      window.openCategory = wrappedOpenCategory;
    }

    window.showMenuCategories = function () {
      document.querySelectorAll(".menu-section").forEach((sec) => (sec.style.display = "none"));
      hero.style.display = "none";
      homeMenu.style.display = "grid";
      menuHomeBar.style.display = "flex";
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    window.goHome = function () {
      document.querySelectorAll(".menu-section").forEach((sec) => (sec.style.display = "none"));
      homeMenu.style.display = "none";
      menuHomeBar.style.display = "none";
      hero.style.display = "block";
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    window.goHome();
  }

  function setupRewardsHomeLink() {
    const isRewardsPage = window.location.pathname.endsWith("/rewards.html") || window.location.pathname.endsWith("rewards.html");
    if (!isRewardsPage || document.getElementById("kweider-rewards-home-link")) return;
    addHomeHubStyles();
    const link = document.createElement("a");
    link.id = "kweider-rewards-home-link";
    link.className = "kweider-rewards-home-link";
    link.href = "index.html";
    link.textContent = "← Home | الرئيسية";
    link.setAttribute("aria-label", "Return to Kweider home");
    document.body.appendChild(link);
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateRewardsBannerCopy();
    updateHomeBadge();
    setupHomeHub();
    setupRewardsHomeLink();
    const loading = document.getElementById("appLoading");
    if (loading) {
      loading.style.opacity = "0";
      loading.addEventListener(
        "transitionend",
        () => loading.remove(),
        { once: true },
      );
    }
  });
  window.addEventListener("kweider-rewards-updated", updateHomeBadge);
  window.addEventListener("storage", updateHomeBadge);
})();