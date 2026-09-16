(function () {
  "use strict";
  let deferredPrompt = null;
  const installButtons = () => document.querySelectorAll("[data-install-app]");

  if (document.getElementById("main-menu")) {
    const menuContrastFix = document.createElement("link");
    menuContrastFix.rel = "stylesheet";
    menuContrastFix.href = "assets/css/menu-text-contrast-fix.css?v=20260916-rewards";
    document.head.appendChild(menuContrastFix);

    const menuLuxuryPanels = document.createElement("link");
    menuLuxuryPanels.rel = "stylesheet";
    menuLuxuryPanels.href = "assets/css/menu-luxury-panels.css?v=20260916-1";
    document.head.appendChild(menuLuxuryPanels);
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
  document.addEventListener("DOMContentLoaded", () => {
    updateRewardsBannerCopy();
    updateHomeBadge();
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
