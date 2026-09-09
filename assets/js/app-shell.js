(function () {
  "use strict";
  let deferredPrompt = null;
  const installButtons = () => document.querySelectorAll("[data-install-app]");

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

  function updateHomeBadge() {
    const el = document.querySelector("[data-rewards-chip]");
    if (!el) return;
    const hasSavedCard = Boolean(
      localStorage.getItem("kweiderRewards.memberToken.v1"),
    );
    el.textContent = hasSavedCard ? "My rewards" : "Join now";
  }
  document.addEventListener("DOMContentLoaded", () => {
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
