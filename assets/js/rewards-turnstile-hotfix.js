(function () {
  "use strict";

  const MAX_WAIT_MS = 10000;
  const RETRY_DELAY_MS = 450;
  const startedAt = Date.now();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normaliseUkPhoneForRegistration(value) {
    let phone = String(value || "").trim().replace(/[\s()-]/g, "");
    if (phone.startsWith("0044")) phone = `+44${phone.slice(4)}`;
    return phone;
  }

  function installHotfix() {
    if (window.__kweiderTurnstileHotfixInstalled) return true;
    if (
      typeof window.requestTurnstileToken !== "function" ||
      typeof window.callApi !== "function" ||
      typeof window.resetTurnstile !== "function"
    ) {
      return false;
    }

    const originalRequestTurnstileToken = window.requestTurnstileToken;
    const originalCallApi = window.callApi;

    window.requestTurnstileToken = async function resilientTurnstileToken() {
      try {
        return await originalRequestTurnstileToken();
      } catch (firstError) {
        window.resetTurnstile();
        await sleep(RETRY_DELAY_MS);
        return await originalRequestTurnstileToken();
      }
    };

    window.callApi = async function resilientRewardsApi(payload, customerAccessToken = "") {
      if (!payload || payload.action !== "create_member") {
        return originalCallApi(payload, customerAccessToken);
      }

      const registrationPayload = {
        ...payload,
        phone: normaliseUkPhoneForRegistration(payload.phone),
      };

      try {
        return await originalCallApi(registrationPayload, customerAccessToken);
      } catch (error) {
        if (error?.code !== "turnstile_failed") throw error;

        window.resetTurnstile();
        await sleep(RETRY_DELAY_MS);
        const freshToken = await window.requestTurnstileToken();
        if (!freshToken) throw error;

        return originalCallApi(
          { ...registrationPayload, turnstileToken: freshToken },
          customerAccessToken,
        );
      }
    };

    window.__kweiderTurnstileHotfixInstalled = true;
    console.info("Kweider rewards security retry is active.");
    return true;
  }

  function waitForRewardsPage() {
    if (installHotfix()) return;
    if (Date.now() - startedAt >= MAX_WAIT_MS) {
      console.warn("Kweider rewards security retry could not attach in time.");
      return;
    }
    setTimeout(waitForRewardsPage, 50);
  }

  waitForRewardsPage();
})();
