      "use strict";

      const SUPABASE_URL = "https://fwjiceleybxhgetsvsvp.supabase.co";
      const SUPABASE_PUBLISHABLE_KEY =
        "sb_publishable_yNgSShCyeQ6FfSy30T6-hg_9dLXXpwk";
      const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/kweider-rewards-api`;
      const MEMBER_TOKEN_KEY = "kweiderRewards.memberToken.v1";
      const PUSH_PUBLIC_KEY = "BObV1-FPmgq3iFLHBWgc2h1SZoJWCaQ6i2lb38g_zvRbZdaIxQkxlvu-09Qnywtj-hR2VtFLXrT5fc_urWDbWUA";

      const $ = (id) => document.getElementById(id);

      let activeBundle = null;
      let requestInProgress = false;
      let restoredCardNoticePending = false;
      let activePinResetToken = "";
      let pinResetPollTimer = null;
      let notificationStateRequest = 0;
      let notificationPromptShown = false;
      let turnstileResolve = null;
      let turnstileReject = null;

      function clearTurnstilePending() {
        turnstileResolve = null;
        turnstileReject = null;
      }

      window.onTurnstileSuccess = (token) => {
        const resolve = turnstileResolve;
        clearTurnstilePending();
        if (resolve) resolve(String(token || ""));
      };

      window.onTurnstileError = () => {
        const reject = turnstileReject;
        clearTurnstilePending();
        if (reject) reject(new Error("Security verification failed. Please try again."));
      };

      function resetTurnstile() {
        try {
          if (window.turnstile?.reset) window.turnstile.reset("#turnstileWidget");
        } catch (error) {
          console.warn("Unable to reset the security check:", error);
        }
      }

      function requestTurnstileToken() {
        if (!window.turnstile?.execute) {
          return Promise.reject(new Error("The security check is still loading. Please try again."));
        }
        return new Promise((resolve, reject) => {
          turnstileResolve = resolve;
          turnstileReject = reject;
          try {
            window.turnstile.execute("#turnstileWidget");
          } catch (error) {
            clearTurnstilePending();
            reject(new Error("Security verification could not start. Please try again."));
          }
        });
      }

      function openNotificationPrompt() {
        if (notificationPromptShown || !$("notificationPrompt")) return;
        notificationPromptShown = true;
        $("notificationPrompt").classList.remove("hidden");
        document.body.style.overflow = "hidden";
      }

      function closeNotificationPrompt() {
        if (!$("notificationPrompt")) return;
        $("notificationPrompt").classList.add("hidden");
        document.body.style.overflow = "";
      }

      const REWARD_SELECTION_KEY_PREFIX =
        "kweiderRewards.checkoutSelection.v1.";
      let customerSelectionMemberCode = "";
      let customerSelectedRewardId = "";
      let customerRewardIntentConfirmed = false;
      let customerAvailableRewards = [];
      let customerRewardDefinitions = [];

      function esc(value) {
        return String(value ?? "").replace(
          /[&<>'"]/g,
          (char) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              "'": "&#39;",
              '"': "&quot;",
            })[char],
        );
      }

      function readField(object, ...keys) {
        for (const key of keys) {
          if (object && object[key] !== undefined && object[key] !== null) {
            return object[key];
          }
        }
        return null;
      }

      function embeddedDefinitionOf(reward) {
        const embedded = readField(
          reward,
          "definition",
          "rewardDefinition",
          "reward_definition",
        );
        return embedded && typeof embedded === "object" ? embedded : null;
      }

      function rewardCodeOf(reward) {
        const embedded = embeddedDefinitionOf(reward);
        return String(
          readField(reward, "rewardCode", "reward_code", "code") ||
            readField(embedded, "code") ||
            "",
        );
      }

      function rewardDefinitionIdOf(reward) {
        const embedded = embeddedDefinitionOf(reward);
        return String(
          readField(
            reward,
            "rewardDefinitionId",
            "reward_definition_id",
            "definitionId",
            "definition_id",
          ) ||
            readField(embedded, "id") ||
            "",
        );
      }

      function definitionCodeOf(definition) {
        return String(readField(definition, "code") || "");
      }

      function definitionIdOf(definition) {
        return String(readField(definition, "id") || "");
      }

      function definitionForReward(reward, definitions) {
        const embedded = embeddedDefinitionOf(reward);
        if (embedded) return embedded;

        const definitionId = rewardDefinitionIdOf(reward);
        if (definitionId) {
          const byId = definitions.find(
            (definition) => definitionIdOf(definition) === definitionId,
          );
          if (byId) return byId;
        }

        const code = rewardCodeOf(reward);
        if (code) {
          return (
            definitions.find(
              (definition) => definitionCodeOf(definition) === code,
            ) || null
          );
        }

        return null;
      }

      function rewardTitle(definition, reward = null) {
        const code =
          definitionCodeOf(definition) || rewardCodeOf(reward);
        const fallbackTitles = {
          discount_3: "£5 Off Your Next Bill",
          discount_5: "Another £5 Off Your Next Bill",
          breakfast_for_two: "Breakfast for Two",
        };

        return String(
          readField(definition, "titleEn", "title_en") ||
            fallbackTitles[code] ||
            code ||
            "Reward",
        );
      }

      function rewardStatusOf(reward) {
        const rawStatus = String(readField(reward, "status") || "")
          .trim()
          .toLowerCase();

        const normalized = {
          available: "available",
          ready: "available",
          unlocked: "available",
          issued: "available",
          active: "available",
          redeemed: "redeemed",
          used: "redeemed",
          claimed: "redeemed",
          consumed: "redeemed",
          expired: "expired",
          cancelled: "expired",
          canceled: "expired",
          void: "expired",
        };

        return normalized[rawStatus] || rawStatus;
      }

      function isAvailableReward(reward) {
        if (!reward || rewardStatusOf(reward) !== "available")
          return false;
        const expiresAt = readField(reward, "expiresAt", "expires_at");
        if (!expiresAt) return true;
        const expiryTime = new Date(expiresAt).getTime();
        return Number.isFinite(expiryTime) && expiryTime > Date.now();
      }

      const REWARD_CYCLE_POINTS = 200;
      const REWARD_LEVELS = [
        {
          code: "discount_3",
          threshold: 50,
          titleEn: "£5 OFF",
          titleAr: "خصم £5",
          position: 0,
        },
        {
          code: "discount_5",
          threshold: 100,
          titleEn: "ANOTHER £5 OFF",
          titleAr: "خصم £5 إضافية",
          position: 50,
        },
        {
          code: "breakfast_for_two",
          threshold: 200,
          titleEn: "BREAKFAST ×2",
          titleAr: "فطور لشخصين",
          position: 100,
        },
      ];

      function rewardCycleState(totalPoints) {
        const points = Math.max(0, Math.floor(Number(totalPoints) || 0));
        if (points === 0) {
          return { cycleNumber: 1, cycleBase: 0, cyclePoints: 0 };
        }

        // A 200-point boundary belongs to the cycle just completed.
        // The next reward cycle starts on the following point (201, 401, ...),
        // matching the database reward-cycle logic.
        const cycleNumber = Math.floor((points - 1) / REWARD_CYCLE_POINTS) + 1;
        const cycleBase = (cycleNumber - 1) * REWARD_CYCLE_POINTS;
        const cyclePoints = ((points - 1) % REWARD_CYCLE_POINTS) + 1;

        return { cycleNumber, cycleBase, cyclePoints };
      }

      function rewardForLevel(memberRewards, level, cycleNumber) {
        return (
          memberRewards.find(
            (reward) =>
              rewardCodeOf(reward) === level.code &&
              Number(readField(reward, "cycleNumber", "cycle_number") || 0) ===
                cycleNumber,
          ) || null
        );
      }

      function levelStatus(memberRewards, level, cycleNumber, cyclePoints) {
        const reward = rewardForLevel(memberRewards, level, cycleNumber);
        const status = rewardStatusOf(reward);

        if (status === "redeemed") return "redeemed";
        if (status === "available") {
          return isAvailableReward(reward) ? "available" : "expired";
        }
        if (status === "expired") return "expired";
        return cyclePoints >= level.threshold ? "reached" : "upcoming";
      }

      function renderRewardJourney(points, memberRewards, rewardDefinitions) {
        const cycle = rewardCycleState(points);
        const isNewCycle = cycle.cycleNumber > 1 && cycle.cyclePoints === 1;
        const cycleLabelEn = isNewCycle ? "New reward cycle" : "Reward cycle";
        const cycleLabelAr = isNewCycle
          ? "دورة مكافآت جديدة"
          : "دورة المكافآت";
        $("rewardCycleCounter").innerHTML =
          `${esc(cycleLabelEn)}: ${cycle.cyclePoints} / ${REWARD_CYCLE_POINTS}<br />` +
          `<span dir="rtl">${esc(cycleLabelAr)}: ${cycle.cyclePoints} / ${REWARD_CYCLE_POINTS}</span>`;

        const progressPercent = Math.min(
          100,
          Math.max(0, (cycle.cyclePoints / REWARD_CYCLE_POINTS) * 100),
        );
        $("rewardProgress").style.width = `${progressPercent}%`;

        $("rewardMilestones").innerHTML = REWARD_LEVELS.map((level, index) => {
          const status = levelStatus(
            memberRewards,
            level,
            cycle.cycleNumber,
            cycle.cyclePoints,
          );
          const statusText = {
            available: "READY · متاحة",
            redeemed: "USED · مستخدمة",
            expired: "EXPIRED · منتهية",
            reached: "READY · متاحة",
            upcoming: "",
          }[status];

          const edgeClass = `${index === 0 ? " first" : ""}${index === REWARD_LEVELS.length - 1 ? " last" : ""}`;
          return `
            <div class="reward-milestone ${status}${edgeClass}" style="left:${level.position}%">
              <span class="reward-dot">${status === "redeemed" ? "✓" : level.threshold}</span>
              <strong>${esc(level.titleEn)}</strong>
              <small dir="auto">${level.threshold} PTS · ${esc(level.titleAr)}${statusText ? `<br />${esc(statusText)}` : ""}</small>
            </div>`;
        }).join("");

        let nextLevel = REWARD_LEVELS.find(
          (level) => level.threshold > cycle.cyclePoints,
        );
        let targetPoints;

        if (nextLevel) {
          targetPoints = cycle.cycleBase + nextLevel.threshold;
        } else {
          nextLevel = REWARD_LEVELS[0];
          targetPoints = cycle.cycleBase + REWARD_CYCLE_POINTS + nextLevel.threshold;
        }

        const remaining = Math.max(0, targetPoints - points);
        $("progressText").innerHTML = `
          <strong>Next: ${esc(nextLevel.titleEn)} · ${remaining} point${remaining === 1 ? "" : "s"} to go</strong><br />
          <span dir="rtl">التالي: ${esc(nextLevel.titleAr)} · متبقي ${remaining} نقطة</span>`;
      }

      function notice(targetId, text, type = "info") {
        $(targetId).innerHTML = text
          ? `<div class="notice ${type}">${esc(text)}</div>`
          : "";
      }

      function setDisabled(id, disabled) {
        const element = $(id);
        if (element) element.disabled = disabled;
      }


      async function clearCustomerAppBadge() {
        try {
          if ("clearAppBadge" in navigator) {
            await navigator.clearAppBadge();
          }
        } catch (error) {
          console.warn("Unable to clear the Kweider app badge:", error);
        }

        try {
          if ("serviceWorker" in navigator) {
            const registration = await navigator.serviceWorker.ready;
            const worker =
              navigator.serviceWorker.controller || registration.active;
            worker?.postMessage({ type: "CLEAR_APP_BADGE" });
          }
        } catch (error) {
          console.warn("Unable to reset the saved badge count:", error);
        }
      }

      function setLoading(isLoading) {
        requestInProgress = isLoading;
        [
          "openCardButton",
          "newMemberButton",
          "createCardButton",
          "backToLoginButton",
          "savePinButton",
          "forgotPinButton",
          "requestPinResetButton",
          "backFromResetButton",
          "saveResetPinButton",
          "changePinButton",
          "refreshCard",
          "switchMembership",
          "markMessagesRead",
          "confirmRewardChoice",
          "enableNotifications",
          "disableNotifications",
        ].forEach((id) => setDisabled(id, isLoading));
      }

      async function readResponseJson(response, fallbackMessage) {
        let data;
        try {
          data = await response.json();
        } catch {
          throw new Error(fallbackMessage);
        }

        if (!response.ok || data?.ok === false) {
          const error = new Error(
            data?.message || data?.msg || data?.error_description || data?.error || fallbackMessage,
          );
          error.code = data?.code || data?.error_code || data?.error || "request_failed";
          error.status = response.status;
          throw error;
        }

        return data;
      }

      async function callApi(payload, customerAccessToken = "") {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
          const headers = {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          };
          if (customerAccessToken) {
            headers.Authorization = `Bearer ${customerAccessToken}`;
          }

          const response = await fetch(FUNCTION_URL, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          return await readResponseJson(
            response,
            "The rewards service returned an invalid response.",
          );
        } catch (error) {
          if (error.name === "AbortError") {
            throw new Error(
              "The rewards service took too long to respond. Please try again.",
            );
          }
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      }

      function urlBase64ToUint8Array(value) {
        const padding = "=".repeat((4 - (value.length % 4)) % 4);
        const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
        const raw = atob(base64);
        return Uint8Array.from(raw, (character) => character.charCodeAt(0));
      }

      async function supportsDeviceNotifications() {
        if (
          !window.isSecureContext ||
          !("serviceWorker" in navigator) ||
          !("Notification" in window)
        ) {
          return false;
        }

        try {
          const registration = await navigator.serviceWorker.ready;
          return Boolean(
            registration?.pushManager &&
            typeof registration.pushManager.getSubscription === "function" &&
            typeof registration.pushManager.subscribe === "function",
          );
        } catch (error) {
          console.warn("Unable to inspect notification support", error);
          return false;
        }
      }

      function isIosDevice() {
        return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
      }

      function isStandaloneApp() {
        return Boolean(
          window.matchMedia?.("(display-mode: standalone)")?.matches ||
          window.navigator.standalone === true,
        );
      }

      function notificationDeviceLabel() {
        const agent = navigator.userAgent || "";
        if (/iphone|ipad|ipod/i.test(agent)) return "iPhone / iPad";
        if (/android/i.test(agent)) return "Android";
        return "Web browser";
      }

      async function currentPushSubscription() {
        if (!("serviceWorker" in navigator)) return null;
        const registration = await navigator.serviceWorker.ready;
        return await registration.pushManager.getSubscription();
      }

      function renderNotificationStatus(text, state = "") {
        const status = $("notificationStatus");
        if (!status) return;
        status.textContent = text;
        status.className = `notification-status${state ? ` ${state}` : ""}`;
      }

      async function syncNotificationPanel(member = activeBundle?.member) {
        if (!$("notificationStatus") || !member) return;
        const requestId = ++notificationStateRequest;
        const accountEnabled = member.notificationConsent === true;

        if (!(await supportsDeviceNotifications())) {
          renderNotificationStatus("Not supported on this browser", "warning");
          $("enableNotifications").classList.add("hidden");
          $("disableNotifications").classList.toggle("hidden", !accountEnabled);
          return;
        }

        if (isIosDevice() && !isStandaloneApp()) {
          renderNotificationStatus("Install the app first on iPhone", "warning");
          $("enableNotifications").classList.remove("hidden");
          $("disableNotifications").classList.toggle("hidden", !accountEnabled);
          return;
        }

        if (Notification.permission === "denied") {
          renderNotificationStatus("Blocked in browser settings", "warning");
          $("enableNotifications").classList.add("hidden");
          $("disableNotifications").classList.toggle("hidden", !accountEnabled);
          return;
        }

        let subscription = null;
        try {
          subscription = await currentPushSubscription();
        } catch (error) {
          console.warn("Unable to inspect push subscription", error);
        }
        if (requestId !== notificationStateRequest) return;

        const deviceEnabled = Boolean(subscription && accountEnabled);
        if (deviceEnabled) {
          renderNotificationStatus("Enabled on this device", "enabled");
          $("enableNotifications").classList.add("hidden");
          $("disableNotifications").classList.remove("hidden");
        } else if (accountEnabled) {
          renderNotificationStatus("Enable alerts on this device", "warning");
          $("enableNotifications").classList.remove("hidden");
          $("disableNotifications").classList.remove("hidden");
          openNotificationPrompt();
        } else {
          renderNotificationStatus("Reward alerts not enabled", "warning");
          $("enableNotifications").classList.remove("hidden");
          $("disableNotifications").classList.add("hidden");
          openNotificationPrompt();
        }
      }

      async function enableRewardNotifications() {
        const token = localStorage.getItem(MEMBER_TOKEN_KEY);
        if (!token) {
          showRegistration("Open your Kweider card before enabling notifications.", "error");
          return;
        }

        if (!(await supportsDeviceNotifications())) {
          notice("notificationMessage", "Notifications are not supported by this browser.", "error");
          return;
        }

        if (isIosDevice() && !isStandaloneApp()) {
          notice(
            "notificationMessage",
            "On iPhone, install Kweider on the Home Screen first, then open the installed app and enable notifications.",
            "info",
          );
          return;
        }

        setLoading(true);
        notice("notificationMessage", "Requesting notification permission…", "info");
        let preferenceEnabled = false;
        let subscription = null;

        try {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            throw new Error("Notification permission was not granted. You can change it later in your browser settings.");
          }

          const preferenceResult = await callApi({
            action: "update_notification_preference",
            token,
            notificationConsent: true,
          });
          preferenceEnabled = true;

          const registration = await navigator.serviceWorker.ready;
          subscription = await registration.pushManager.getSubscription();
          if (!subscription) {
            subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(PUSH_PUBLIC_KEY),
            });
          }

          const subscriptionJson = subscription.toJSON();
          const result = await callApi({
            action: "save_push_subscription",
            token,
            pushEndpoint: subscription.endpoint,
            pushP256dh: subscriptionJson.keys?.p256dh || "",
            pushAuth: subscriptionJson.keys?.auth || "",
            deviceLabel: notificationDeviceLabel(),
            userAgent: navigator.userAgent || "",
          });

          render(result || preferenceResult);
          notice(
            "notificationMessage",
            "Reward notifications are enabled on this device.",
            "ok",
          );
          await syncNotificationPanel(result?.member || preferenceResult?.member);
        } catch (error) {
          if (subscription && preferenceEnabled) {
            try { await subscription.unsubscribe(); } catch {}
          }
          if (preferenceEnabled) {
            try {
              await callApi({
                action: "update_notification_preference",
                token,
                notificationConsent: false,
              });
            } catch {}
          }
          notice(
            "notificationMessage",
            error.message || "Notifications could not be enabled on this device.",
            "error",
          );
          await syncNotificationPanel(activeBundle?.member);
        } finally {
          setLoading(false);
        }
      }

      async function disableRewardNotifications() {
        const token = localStorage.getItem(MEMBER_TOKEN_KEY);
        if (!token) {
          showRegistration("No rewards card is saved on this device.", "error");
          return;
        }

        setLoading(true);
        notice("notificationMessage", "Turning off notifications…", "info");

        try {
          const subscription = await currentPushSubscription();
          if (subscription) {
            await callApi({
              action: "remove_push_subscription",
              token,
              pushEndpoint: subscription.endpoint,
            });
            await subscription.unsubscribe();
          }

          const result = await callApi({
            action: "update_notification_preference",
            token,
            notificationConsent: false,
          });
          render(result);
          notice("notificationMessage", "Reward notifications are turned off.", "ok");
          await syncNotificationPanel(result.member);
        } catch (error) {
          notice(
            "notificationMessage",
            error.message || "Notifications could not be turned off.",
            "error",
          );
        } finally {
          setLoading(false);
        }
      }

      function validFourDigitPin(value) {
        const pin = String(value || "").trim();
        if (!/^\d{4}$/.test(pin)) {
          throw new Error("Enter a 4-digit PIN.");
        }
        return pin;
      }

      function stopPinResetPolling() {
        if (pinResetPollTimer) clearTimeout(pinResetPollTimer);
        pinResetPollTimer = null;
      }

      function showAccessStep(stepId) {
        ["loginStep", "createStep", "resetStep"].forEach((id) => {
          $(id).classList.toggle("hidden", id !== stepId);
        });
        if (stepId !== "resetStep") stopPinResetPolling();
        if (stepId === "loginStep") { notice("cardMessage", ""); notice("formMessage", ""); }
      }

      function resetPinAccess(message = "", type = "info") {
        stopPinResetPolling();
        activePinResetToken = "";
        $("pinLoginForm").reset();
        $("newMemberForm").reset();
        $("pinResetRequestForm").reset();
        $("newPinAfterResetForm").reset();
        $("newPinAfterResetForm").classList.add("hidden");
        $("pinResetStatus").innerHTML = "";
        showAccessStep("createStep");
        notice("formMessage", message, type);
      }

      function renderPinResetWaiting(message, status = "pending") {
        const className = status === "approved"
          ? "notice ok"
          : status === "error"
            ? "notice error"
            : "pin-reset-waiting";
        const box = document.createElement("div");
        box.className = className;
        box.textContent = String(message || "");
        $("pinResetStatus").replaceChildren(box);
      }

      async function pollPinResetStatus() {
        stopPinResetPolling();
        if (!activePinResetToken || $("resetStep").classList.contains("hidden")) return;

        try {
          const result = await callApi({
            action: "check_pin_reset",
            resetToken: activePinResetToken,
          });
          const status = result?.pinResetRequest?.status || "";

          if (status === "approved") {
            renderPinResetWaiting("Approved. Restoring your card...", "approved");
            $("pinResetRequestForm").classList.add("hidden");
            const resetToken = activePinResetToken;
            const restored = await callApi({ action: "complete_pin_reset", resetToken });
            stopPinResetPolling();
            activePinResetToken = "";
            restoredCardNoticePending = true;
            await saveReturnedCard(restored);
            return;
          }

          if (["expired", "cancelled", "used"].includes(status)) {
            activePinResetToken = "";
            $("pinResetRequestForm").classList.remove("hidden");
            renderPinResetWaiting("This request is no longer active. Start again. · انتهت صلاحية الطلب، ابدأ من جديد.", "error");
            return;
          }

          renderPinResetWaiting("Waiting for staff approval… Keep this screen open. · بانتظار موافقة الموظف، اترك هذه الشاشة مفتوحة.");
          pinResetPollTimer = setTimeout(pollPinResetStatus, 2500);
        } catch (error) {
          renderPinResetWaiting(error.message || "The reset status could not be checked.", "error");
          pinResetPollTimer = setTimeout(pollPinResetStatus, 4000);
        }
      }

      async function saveReturnedCard(result) {
        if (!result?.token) {
          throw new Error("The secure membership token was not returned.");
        }
        localStorage.setItem(MEMBER_TOKEN_KEY, result.token);
        render(result);
      }

      function recoveryTokenFromUrl() {
        const hash = window.location.hash.replace(/^#/, "");
        if (!hash) return "";
        return new URLSearchParams(hash).get("recover") || "";
      }

      function clearRecoveryTokenFromUrl() {
        history.replaceState(
          null,
          document.title,
          `${window.location.pathname}${window.location.search}`,
        );
      }

      async function restoreCardFromLink(recoveryToken) {
        setLoading(true);

        try {
          const result = await callApi({
            action: "recover_card",
            recoveryToken,
          });

          if (!result.token) {
            throw new Error("The restored membership token was not returned.");
          }

          localStorage.setItem(MEMBER_TOKEN_KEY, result.token);
          restoredCardNoticePending = true;
          render(result);
        } finally {
          setLoading(false);
        }
      }

      function showRegistration(message = "", type = "info") {
        // KWEIDER_IOS_INSTALL_GATE
        if (isIosDevice() && !isStandaloneApp()) {
          activeBundle = null;
          $("membershipArea").classList.add("hidden");
          $("registrationCard").classList.remove("hidden");
          showAccessStep("createStep");
          $("newMemberForm").classList.add("hidden");
          const otherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent || "");
          notice("formMessage", otherIosBrowser ? "Open this link in Safari first. Then tap Share and Add to Home Screen. Open the installed Kweider app to register." : "Tap Share, choose Add to Home Screen, then open the installed Kweider app to register.", "info");
          return;
        }
        $("newMemberForm").classList.remove("hidden");
        activeBundle = null;
        customerSelectionMemberCode = "";
        customerSelectedRewardId = "";
        customerRewardIntentConfirmed = false;
        customerAvailableRewards = [];
        customerRewardDefinitions = [];
        $("membershipArea").classList.add("hidden");
        $("registrationCard").classList.remove("hidden");
        showAccessStep("createStep");
        notice("formMessage", message, type);
      }

      function transactionTitle(transaction) {
        if (transaction.type === "earn") {
          const amount = Number(transaction.purchaseAmount || 0);
          return amount > 0
            ? `Purchase points · £${amount.toFixed(2)}`
            : "Purchase points";
        }

        if (transaction.type === "redeem") {
          const value = Number(transaction.rewardValue || 0);
          return value > 0
            ? `Reward redeemed · £${value.toFixed(2)}`
            : "Reward redeemed";
        }

        if (transaction.type === "welcome") {
          return "Welcome to Kweider Rewards";
        }

        return transaction.notes || "Rewards activity";
      }

      function compactRewardTitle(reward, definition) {
        const code = definitionCodeOf(definition) || rewardCodeOf(reward);
        const labels = {
          discount_3: "£5 Reward ready · مكافأة £5 جاهزة",
          discount_5: "Another £5 reward ready · مكافأة £5 إضافية جاهزة",
          breakfast_for_two: "Breakfast for Two ready · فطور لشخصين جاهز",
        };
        return labels[code] || rewardTitle(definition, reward);
      }


      function rewardDisplayDetails(reward, definition) {
        const code = definitionCodeOf(definition) || rewardCodeOf(reward);
        const details = {
          discount_3: {
            shortTitle: "£5 OFF",
            titleAr: "خصم £5 على فاتورتك القادمة",
          },
          discount_5: {
            shortTitle: "£5 OFF",
            titleAr: "خصم £5 إضافية على فاتورتك القادمة",
          },
          breakfast_for_two: {
            shortTitle: "BREAKFAST ×2",
            titleAr: "فطور لشخصين",
          },
        }[code] || {
          shortTitle: rewardTitle(definition, reward),
          titleAr: String(readField(definition, "titleAr", "title_ar") || ""),
        };

        const expiresAt = readField(reward, "expiresAt", "expires_at");
        const expiryTime = expiresAt ? new Date(expiresAt).getTime() : NaN;
        const expiryText = Number.isFinite(expiryTime)
          ? new Date(expiryTime).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "";

        return { ...details, expiryText };
      }

      function rewardSelectionKey(memberCode) {
        return `${REWARD_SELECTION_KEY_PREFIX}${memberCode}`;
      }

      function readStoredRewardSelection(memberCode) {
        try {
          const raw = localStorage.getItem(rewardSelectionKey(memberCode));
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
          return null;
        }
      }

      function clearStoredRewardSelection(memberCode) {
        if (!memberCode) return;
        localStorage.removeItem(rewardSelectionKey(memberCode));
      }

      function rewardPriority(reward, definitions) {
        const definition = definitionForReward(reward, definitions) || {};
        const maximum = Number(
          readField(definition, "maximumDiscount", "maximum_discount"),
        );
        if (Number.isFinite(maximum) && maximum > 0) return maximum;
        return Number(
          readField(definition, "thresholdPoints", "threshold_points") || 0,
        );
      }

      function selectedCustomerReward() {
        return (
          customerAvailableRewards.find(
            (reward) =>
              String(readField(reward, "id") || "") ===
              customerSelectedRewardId,
          ) || null
        );
      }

      function renderMemberQr(member) {
        $("qrCode").innerHTML = "";

        let qrText = `KWEIDER-REWARDS:${member.memberCode}`;
        const selectedReward = selectedCustomerReward();

        if (
          customerRewardIntentConfirmed &&
          selectedReward &&
          customerSelectedRewardId
        ) {
          qrText += `|MR:${customerSelectedRewardId}`;
        }

        if (window.QRCode && member.memberCode) {
          new QRCode($("qrCode"), {
            text: qrText,
            width: 170,
            height: 170,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H,
          });
        } else {
          $("qrCode").innerHTML =
            `<div style="color:#000;padding:20px">${esc(member.memberCode || "")}</div>`;
        }

        if (
          customerRewardIntentConfirmed &&
          selectedReward
        ) {
          const definition =
            definitionForReward(
              selectedReward,
              customerRewardDefinitions,
            ) || {};
          const display = rewardDisplayDetails(
            selectedReward,
            definition,
          );
          $("qrSelectionStatus").textContent =
            `${display.shortTitle} selected ✓ · تم اختيار المكافأة`;
        } else {
          $("qrSelectionStatus").textContent = "";
        }
      }

      function renderCustomerRewardPicker(
        member,
        availableRewards,
        definitions,
      ) {
        customerAvailableRewards = [...availableRewards].sort(
          (left, right) =>
            rewardPriority(left, definitions) -
            rewardPriority(right, definitions),
        );
        customerRewardDefinitions = definitions;

        const memberCode = String(member.memberCode || "");
        const availableIds = new Set(
          customerAvailableRewards.map((reward) =>
            String(readField(reward, "id") || ""),
          ),
        );

        const sameMember =
          customerSelectionMemberCode === memberCode;
        const stored = readStoredRewardSelection(memberCode);
        const storedId = String(stored?.memberRewardId || "");

        if (storedId && !availableIds.has(storedId)) {
          clearStoredRewardSelection(memberCode);
        }

        if (
          !sameMember ||
          !availableIds.has(customerSelectedRewardId)
        ) {
          customerSelectedRewardId =
            availableIds.has(storedId)
              ? storedId
              : String(
                  readField(
                    customerAvailableRewards[
                      customerAvailableRewards.length - 1
                    ],
                    "id",
                  ) || "",
                );
          customerRewardIntentConfirmed =
            availableIds.has(storedId) &&
            stored?.confirmed === true;
        }

        customerSelectionMemberCode = memberCode;

        if (!customerAvailableRewards.length) {
          customerSelectedRewardId = "";
          customerRewardIntentConfirmed = false;
          clearStoredRewardSelection(memberCode);
          $("cardRewardPicker").removeAttribute("open");
          $("cardRewardPicker").classList.add("hidden");
          renderMemberQr(member);
          return;
        }

        const rewardCount = customerAvailableRewards.length;
        $("rewardAccordionTitleEn").textContent =
          `Open Your Rewards (${rewardCount})`;
        $("rewardAccordionStatusEn").textContent =
          `You have ${rewardCount} reward${rewardCount === 1 ? "" : "s"} ready to use`;
        $("rewardAccordionTitleAr").textContent =
          `افتح جوائزك (${rewardCount}) · لديك ${rewardCount} ${rewardCount === 1 ? "جائزة" : "جوائز"} جاهزة للاستخدام`;
        $("cardRewardPicker").classList.remove("hidden");
        $("cardRewardChoices").innerHTML =
          customerAvailableRewards
            .map((reward) => {
              const id = String(readField(reward, "id") || "");
              const definition =
                definitionForReward(reward, definitions) || {};
              const display = rewardDisplayDetails(
                reward,
                definition,
              );
              return `
                <button
                  type="button"
                  class="reward-choice-chip${id === customerSelectedRewardId ? " selected" : ""}"
                  data-reward-id="${esc(id)}"
                >
                  <strong>${esc(display.shortTitle)}</strong>
                  <span>${esc(display.titleAr)}</span>
                </button>`;
            })
            .join("");

        const reward = selectedCustomerReward();
        const definition =
          definitionForReward(reward, definitions) || {};
        const display = rewardDisplayDetails(reward, definition);

        $("cardSelectedRewardTitle").textContent =
          display.shortTitle;
        $("cardSelectedRewardSubtitle").textContent =
          display.titleAr;
        $("cardSelectedRewardExpiry").textContent =
          display.expiryText
            ? `Valid until ${display.expiryText}`
            : "";

        const button = $("confirmRewardChoice");
        button.classList.toggle(
          "confirmed",
          customerRewardIntentConfirmed,
        );
        button.textContent = customerRewardIntentConfirmed
          ? "Selected ✓"
          : "Use at checkout";

        renderMemberQr(member);
      }

      function compactMessageCard(message) {
        const createdAt = readField(message, "createdAt", "created_at");
        const expiresAt = readField(message, "expiresAt", "expires_at");
        const isRead = Boolean(readField(message, "isRead", "is_read"));
        const messageDate = createdAt
          ? new Date(createdAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "";
        const expiryDate = expiresAt
          ? new Date(expiresAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "";
        let titleEn = String(
          readField(message, "titleEn", "title_en") || "Kweider Rewards",
        );
        let bodyEn = String(readField(message, "bodyEn", "body_en") || "");
        let bodyAr = String(readField(message, "bodyAr", "body_ar") || "");
        const actionLabel = String(
          readField(message, "actionLabel", "action_label") || "",
        ).trim();
        const rawActionUrl = String(
          readField(message, "actionUrl", "action_url") || "",
        ).trim();
        let actionUrl = "";
        if (rawActionUrl) {
          try {
            const parsedActionUrl = new URL(rawActionUrl);
            if (parsedActionUrl.protocol === "https:") {
              actionUrl = parsedActionUrl.toString();
            }
          } catch {}
        }
        const breakfastRewardMessage = /breakfast\s*(for\s*)?two|breakfast\s*[×x]2/i.test(
          `${titleEn} ${bodyEn}`,
        ) || /فطور\s*(مجاني\s*)?لشخصين/.test(bodyAr);
        if (breakfastRewardMessage) {
          titleEn = "🎉 Congratulations!";
          bodyEn = "Your reward is a free breakfast for two! 🎉";
          bodyAr = "🎉 مبروك! جائزتك فطور مجاني لشخصين 🎉";
        }

        return `
          <article class="compact-message-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
              <strong>${esc(titleEn)}</strong>
              ${isRead ? "" : '<span style="width:8px;height:8px;border-radius:50%;background:#c5a059;flex:0 0 auto;margin-top:5px"></span>'}
            </div>
            ${bodyEn ? `<p class="compact-message-line">${esc(bodyEn)}</p>` : ""}
            ${bodyAr ? `<p class="compact-message-line" dir="rtl" style="text-align:right;color:#c8c0b0">${esc(bodyAr)}</p>` : ""}
            ${(messageDate || expiryDate) ? `<div class="compact-date">${esc(messageDate)}${expiryDate ? ` · Valid until ${esc(expiryDate)}` : ""}</div>` : ""}
            ${actionLabel && actionUrl ? `<a class="compact-message-action" href="${esc(actionUrl)}" target="_blank" rel="noopener noreferrer">${esc(actionLabel)} →</a>` : ""}
          </article>`;
      }

      function transactionMarkup(transaction) {
        const pointsDelta = Number(transaction.pointsDelta || 0);
        const dateText = transaction.createdAt
          ? new Date(transaction.createdAt).toLocaleString("en-GB")
          : "";
        const extra = [
          transaction.receiptReference
            ? `Receipt ${transaction.receiptReference}`
            : "",
          transaction.performedByName || "",
          dateText,
        ]
          .filter(Boolean)
          .join(" · ");
        const isRedeem = transaction.type === "redeem";
        const valueText = isRedeem && pointsDelta === 0
          ? "USED"
          : `${pointsDelta > 0 ? "+" : ""}${pointsDelta}`;

        return `
          <li>
            <div class="transaction-main">
              <strong>${esc(transactionTitle(transaction))}</strong>
              <span>${esc(extra || transaction.notes || "")}</span>
            </div>
            <div class="tx-points ${pointsDelta >= 0 ? "positive" : "negative"}">${esc(valueText)}</div>
          </li>`;
      }

      function renderWelcomeCoffee(coffee) {
        const card = $("welcomeCoffeeCard");
        const text = $("welcomeCoffeeText");
        const status = $("welcomeCoffeeStatus");

        if (!coffee) {
          card.classList.add("hidden");
          return;
        }

        card.classList.remove("hidden");
        const coffeeStatus = String(readField(coffee, "status") || "");
        const expiresAt = readField(coffee, "expiresAt", "expires_at");
        const expiryText = expiresAt
          ? new Date(expiresAt).toLocaleDateString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
          : "";

        status.className = "welcome-coffee-status";

        if (coffeeStatus === "available") {
          text.textContent =
            "Enjoy one complimentary Syrian coffee with your first paid dine-in order.";
          status.textContent = expiryText
            ? `READY · Valid until ${expiryText}`
            : "READY";
          return;
        }

        if (coffeeStatus === "redeemed") {
          card.classList.add("hidden");
          text.textContent = "";
          status.textContent = "";
          return;
        }

        text.textContent = "This welcome coffee offer has expired.";
        status.textContent = "EXPIRED";
        status.classList.add("expired");
      }

      function render(bundle) {
        if (!bundle || !bundle.member) {
          showRegistration("The membership card could not be loaded.", "error");
          return;
        }

        activeBundle = bundle;
        void clearCustomerAppBadge();

        const member = bundle.member;
        const points = Number(member.points || 0);
        const definitionsPayload =
          bundle.rewardDefinitions ||
          bundle.reward_definitions ||
          bundle.definitions;
        const rewardsPayload =
          bundle.rewards || bundle.memberRewards || bundle.member_rewards;

        const rewardDefinitions = Array.isArray(definitionsPayload)
          ? [...definitionsPayload].sort(
              (left, right) =>
                Number(
                  readField(left, "thresholdPoints", "threshold_points") || 0,
                ) -
                Number(
                  readField(right, "thresholdPoints", "threshold_points") || 0,
                ),
            )
          : [];
        const memberRewards = Array.isArray(rewardsPayload)
          ? rewardsPayload
          : [];
        const availableRewards = memberRewards.filter(isAvailableReward);

        $("registrationCard").classList.add("hidden");
        $("membershipArea").classList.remove("hidden");
        $("memberName").textContent = member.firstName || "Kweider Member";
        $("memberId").textContent = member.memberCode || "";
        $("memberPoints").textContent = points;
        $("rewardAvailable").textContent = String(availableRewards.length);
        $("pinSetupPanel").classList.add("hidden");
        renderWelcomeCoffee(
          bundle.welcomeCoffee || bundle.welcome_coffee || null,
        );
        renderRewardJourney(points, memberRewards, rewardDefinitions);

        renderCustomerRewardPicker(
          member,
          availableRewards,
          rewardDefinitions,
        );
        $("noRewardsMotivation").classList.toggle(
          "hidden",
          availableRewards.length > 0,
        );

        const rawMemberMessages = Array.isArray(bundle.messages)
          ? bundle.messages
          : [];
        // Show smart reward reminders as well as general account messages.
        const memberMessages = rawMemberMessages;
        const unreadMessageCount = memberMessages.filter(
          (message) => !readField(message, "isRead", "is_read"),
        ).length;

        $("messageBadge").textContent =
          unreadMessageCount > 99 ? "99+" : String(unreadMessageCount);
        $("messageBadge").style.display =
          unreadMessageCount > 0 ? "flex" : "none";
        $("messageActions").style.display = "none";
        $("messagesHeader").style.display = memberMessages.length > 0 ? "flex" : "none";
        $("messagesCard").classList.toggle(
          "previous-only",
          unreadMessageCount === 0 && memberMessages.length > 0,
        );

        const unreadMessages = memberMessages.filter(
          (message) => !readField(message, "isRead", "is_read"),
        );
        const readMessages = memberMessages.filter(
          (message) => Boolean(readField(message, "isRead", "is_read")),
        );

        if (unreadMessages.length) {
          const latestMessage = compactMessageCard(unreadMessages[0]);
          const olderMessages = [...unreadMessages.slice(1), ...readMessages];
          $("memberMessages").innerHTML = latestMessage +
            (olderMessages.length
              ? `<details class="compact-inline-details">
                   <summary>Older Messages (${olderMessages.length})</summary>
                   <div class="compact-stack">${olderMessages.map(compactMessageCard).join("")}</div>
                 </details>`
              : "");
        } else if (readMessages.length) {
          $("memberMessages").innerHTML = `
            <details class="compact-inline-details">
              <summary>Previous Messages (${readMessages.length})</summary>
              <div class="compact-stack">${readMessages.map(compactMessageCard).join("")}</div>
            </details>`;
        } else {
          $("memberMessages").innerHTML = "";
        }

        $("messagesCard").style.display =
          memberMessages.length ? "block" : "none";

        $("profileDetails").innerHTML =
          `<strong>Phone:</strong> ${esc(member.phone || "—")}<br>` +
          `<strong>Email:</strong> ${esc(member.email || "—")}<br>` +
          `<strong>Birthday:</strong> ${esc(member.birthday || "—")}<br>` +
          `<strong>Reward notifications:</strong> ${member.notificationConsent ? "Allowed" : "Off"}`;

        void syncNotificationPanel(member);

        const transactions = Array.isArray(bundle.transactions)
          ? bundle.transactions.slice(0, 10)
          : [];
        $("transactions").innerHTML = transactions.length
          ? transactionMarkup(transactions[0])
          : "<li>No activity yet.</li>";

        const olderTransactions = transactions.slice(1);
        $("olderTransactions").innerHTML = olderTransactions
          .map(transactionMarkup)
          .join("");
        $("activityMore").classList.toggle("hidden", !olderTransactions.length);
        $("activityMoreLabel").textContent = olderTransactions.length
          ? `View Earlier Activity (${olderTransactions.length})`
          : "";

        if (restoredCardNoticePending) {
          notice(
            "cardMessage",
            "Your Kweider Rewards card has been restored on this device.",
            "ok",
          );
          restoredCardNoticePending = false;
        } else {
          notice("cardMessage", "", "info");
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
      }

      async function loadSavedCard(showMissingMessage = true) {
        const token = localStorage.getItem(MEMBER_TOKEN_KEY);

        if (!token) {
          showRegistration(
            showMissingMessage
              ? "Join with your first name and mobile number, or choose Already a Member? to restore your existing card. · سجّل باسمك ورقم هاتفك، أو اختر Already a Member? لاستعادة بطاقتك الحالية."
              : "",
            "info",
          );
          return;
        }

        setLoading(true);
        notice("cardMessage", "Refreshing your rewards card…", "info");

        try {
          const result = await callApi({
            action: "get_card",
            token,
          });
          render(result);
        } catch (error) {
          if (
            error.code === "invalid_card_token" ||
            error.code === "membership_unavailable"
          ) {
            localStorage.removeItem(MEMBER_TOKEN_KEY);
            showRegistration(
              "This card was moved to another device. Choose Already a Member? and ask staff to restore it here. · تم نقل البطاقة إلى جهاز آخر. اختر Already a Member? واطلب من الموظف استعادتها على هذا الجهاز.",
              "error",
            );
          } else {
            if (activeBundle) {
              notice("cardMessage", error.message, "error");
            } else {
              showRegistration(error.message, "error");
            }
          }
        } finally {
          setLoading(false);
        }
      }


      $("cardRewardChoices").addEventListener("click", (event) => {
        const button = event.target.closest("[data-reward-id]");
        if (!button || !activeBundle?.member) return;

        customerSelectedRewardId = String(
          button.dataset.rewardId || "",
        );
        customerRewardIntentConfirmed = false;
        clearStoredRewardSelection(
          activeBundle.member.memberCode,
        );

        renderCustomerRewardPicker(
          activeBundle.member,
          customerAvailableRewards,
          customerRewardDefinitions,
        );
        notice(
          "cardMessage",
          "Choose Use at checkout when you are ready to show this reward to staff.",
          "info",
        );
      });

      $("confirmRewardChoice").addEventListener("click", () => {
        if (
          !activeBundle?.member ||
          !selectedCustomerReward()
        ) {
          return;
        }

        customerRewardIntentConfirmed = true;
        localStorage.setItem(
          rewardSelectionKey(
            activeBundle.member.memberCode,
          ),
          JSON.stringify({
            memberRewardId: customerSelectedRewardId,
            confirmed: true,
          }),
        );

        renderCustomerRewardPicker(
          activeBundle.member,
          customerAvailableRewards,
          customerRewardDefinitions,
        );
        notice(
          "cardMessage",
          "Reward selected. Show the QR code to a member of staff.",
          "ok",
        );
        $("qrCode").scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });

      $("forgotPinButton").addEventListener("click", () => {
        stopPinResetPolling();
        activePinResetToken = "";
        $("pinResetRequestForm").classList.remove("hidden");
        $("newPinAfterResetForm").classList.add("hidden");
        $("pinResetStatus").innerHTML = "";
        $("resetPhone").value = $("loginPhone").value.trim();
        showAccessStep("resetStep");
        notice("formMessage", "", "info");
        setTimeout(() => $("resetPhone").focus(), 50);
      });

      $("backFromResetButton").addEventListener("click", () => {
        const phone = $("resetPhone").value.trim();
        stopPinResetPolling();
        activePinResetToken = "";
        showAccessStep("createStep");
        $("createPhone").value = phone;
        $("pinResetRequestForm").classList.remove("hidden");
        $("newPinAfterResetForm").classList.add("hidden");
        $("pinResetStatus").innerHTML = "";
      });

      $("pinResetRequestForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (requestInProgress) return;

        setLoading(true);
        renderPinResetWaiting("Starting your card restore… · جارٍ بدء استعادة بطاقتك…");
        try {
          const result = await callApi({
            action: "request_pin_reset",
            phone: $("resetPhone").value.trim(),
          });
          if (!result?.resetToken) throw new Error("The secure reset request was not returned.");
          activePinResetToken = result.resetToken;
          $("pinResetRequestForm").classList.add("hidden");
          renderPinResetWaiting("Request sent. Ask a member of staff to find your card and press Approve Card Restore. · تم إرسال الطلب. اطلب من أحد الموظفين العثور على بطاقتك والضغط على الموافقة على استعادة البطاقة.");
          pollPinResetStatus();
        } catch (error) {
          renderPinResetWaiting(error.message, "error");
        } finally {
          setLoading(false);
        }
      });

      $("newPinAfterResetForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (requestInProgress || !activePinResetToken) return;

        const pin = validFourDigitPin($("resetNewPin").value);
        if (pin !== validFourDigitPin($("confirmResetNewPin").value)) {
          renderPinResetWaiting("The two PIN entries do not match. · الرقمان غير متطابقين.", "error");
          return;
        }

        setLoading(true);
        renderPinResetWaiting("Restoring your card… · جارٍ استعادة بطاقتك…");
        try {
          const result = await callApi({
            action: "complete_pin_reset",
            resetToken: activePinResetToken,
            pin,
          });
          stopPinResetPolling();
          activePinResetToken = "";
          await saveReturnedCard(result);
          notice("cardMessage", "Your PIN was changed successfully. Older saved cards were signed out. · تم تغيير الرقم السري وتسجيل خروج البطاقات القديمة.", "ok");
        } catch (error) {
          renderPinResetWaiting(error.message, "error");
        } finally {
          setLoading(false);
        }
      });

      $("pinLoginForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (requestInProgress) return;

        let pin;
        try {
          pin = validFourDigitPin($("loginPin").value);
        } catch (error) {
          notice("formMessage", error.message, "error");
          return;
        }

        setLoading(true);
        notice("formMessage", "Restoring your existing rewards card...", "info");

        try {
          const result = await callApi({
            action: "login_with_pin",
            phone: $("loginPhone").value.trim(),
            pin,
          });
          restoredCardNoticePending = true;
          await saveReturnedCard(result);
        } catch (error) {
          notice(
            "formMessage",
            error.code === "pin_not_set"
              ? "This card has no PIN yet. Ask staff for a secure recovery link."
              : error.message,
            "error",
          );
        } finally {
          setLoading(false);
        }
      });

      $("newMemberButton").addEventListener("click", () => {
        const phone = $("loginPhone").value.trim();
        $("newMemberForm").reset();
        $("createPhone").value = phone;
        showAccessStep("createStep");
        notice("formMessage", "Create one membership only for each mobile number.", "info");
        setTimeout(() => $("firstName").focus(), 50);
      });

      $("backToLoginButton").addEventListener("click", () => {
        const phone = $("createPhone").value.trim();
        stopPinResetPolling();
        activePinResetToken = "";
        $("resetPhone").value = phone;
        $("pinResetRequestForm").classList.remove("hidden");
        $("newPinAfterResetForm").classList.add("hidden");
        $("pinResetStatus").innerHTML = "";
        showAccessStep("resetStep");
        setTimeout(() => $("resetPhone").focus(), 50);
      });

      $("newMemberForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (requestInProgress) return;

        setLoading(true);
        notice("formMessage", "Checking security…", "info");
        try {
          const turnstileToken = await requestTurnstileToken();
          if (!turnstileToken) throw new Error("Security verification failed. Please try again.");

          notice("formMessage", "Creating your rewards card…", "info");
          const result = await callApi({
            action: "create_member",
            firstName: $("firstName").value.trim(),
            phone: $("createPhone").value.trim(),
            email: null,
            birthday: null,
            notificationConsent: $("notificationConsent").checked,
            turnstileToken,
          });
          await saveReturnedCard(result);
        } catch (error) {
          if (error.code === "member_exists") {
            const phone = $("createPhone").value.trim();
            showAccessStep("resetStep");
            $("resetPhone").value = phone;
            $("pinResetRequestForm").classList.remove("hidden");
            $("newPinAfterResetForm").classList.add("hidden");
            $("pinResetStatus").innerHTML = "";
            renderPinResetWaiting("This number is already registered. Ask a member of staff to approve restoring your card.");
            notice("formMessage", "", "info");
            setTimeout(() => $("resetPhone").focus(), 50);
          } else {
            notice("formMessage", error.message, "error");
          }
        } finally {
          resetTurnstile();
          setLoading(false);
        }
      });

      $("pinSetupForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (requestInProgress) return;

        const pin = validFourDigitPin($("setupPin").value);
        if (pin !== validFourDigitPin($("confirmSetupPin").value)) {
          notice("cardMessage", "The two PIN entries do not match.", "error");
          return;
        }

        const token = localStorage.getItem(MEMBER_TOKEN_KEY);
        if (!token) {
          showRegistration("No rewards card is saved on this device.", "error");
          return;
        }

        setLoading(true);
        notice("cardMessage", "Saving your access PIN…", "info");
        try {
          const result = await callApi({ action: "set_member_pin", token, pin });
          render(result);
          notice("cardMessage", "Your 4-digit PIN is ready. You can now open this card in the installed app or on another device.", "ok");
        } catch (error) {
          notice("cardMessage", error.message, "error");
        } finally {
          setLoading(false);
        }
      });
      $("changePinForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (requestInProgress) return;

        const pin = validFourDigitPin($("changePin").value);
        if (pin !== validFourDigitPin($("confirmChangePin").value)) {
          notice("cardMessage", "The two PIN entries do not match.", "error");
          return;
        }

        const token = localStorage.getItem(MEMBER_TOKEN_KEY);
        if (!token) {
          showRegistration("No rewards card is saved on this device.", "error");
          return;
        }

        setLoading(true);
        notice("cardMessage", "Changing your access PIN…", "info");
        try {
          const result = await callApi({ action: "set_member_pin", token, pin });
          render(result);
          $("changePinForm").reset();
          notice("cardMessage", "Your access PIN was changed successfully. · تم تغيير الرقم السري بنجاح.", "ok");
        } catch (error) {
          notice("cardMessage", error.message, "error");
        } finally {
          setLoading(false);
        }
      });

      $("enableNotifications").addEventListener("click", enableRewardNotifications);
      $("notificationPromptEnable").addEventListener("click", async () => {
        closeNotificationPrompt();
        await enableRewardNotifications();
      });
      $("notificationPromptLater").addEventListener("click", closeNotificationPrompt);
      $("disableNotifications").addEventListener("click", disableRewardNotifications);

      $("refreshCard").addEventListener("click", () => loadSavedCard(false));
      async function markVisibleMessagesRead() {
    if (requestInProgress) return;

    const badge = $("messageBadge");
    if (!badge || badge.style.display === "none") return;

    const token = localStorage.getItem(MEMBER_TOKEN_KEY);
    if (!token) return;

    try {
      const result = await callApi({
        action: "mark_messages_read",
        token,
      });

      render(result);
    } catch (error) {
      console.error("Unable to mark messages as read:", error);
    }
  }

  $("messagesDetails").addEventListener("toggle", () => {
    if ($("messagesDetails").open) {
      void markVisibleMessagesRead();
    }
  });

  $("switchMembership").addEventListener("click", () => {
        const confirmed = confirm(
          "Remove this rewards card from this device? A member of staff will be needed to restore it later.",
        );

        if (!confirmed) return;

        if (activeBundle?.member?.memberCode) {
          clearStoredRewardSelection(
            activeBundle.member.memberCode,
          );
        }
        localStorage.removeItem(MEMBER_TOKEN_KEY);
        resetPinAccess("The saved card was removed from this device.", "ok");
        showRegistration("The saved card was removed. Ask staff to restore it if needed.", "ok");
        window.scrollTo({ top: 0, behavior: "smooth" });
      });

      window.addEventListener("pagehide", stopPinResetPolling);

      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && activePinResetToken && !requestInProgress) {
          pollPinResetStatus();
          return;
        }
        if (!document.hidden && activeBundle && !requestInProgress) {
          void clearCustomerAppBadge();
          loadSavedCard(false);
          void syncNotificationPanel(activeBundle.member);
        }
      });

      window.addEventListener("storage", (event) => {
        if (event.key === MEMBER_TOKEN_KEY && !requestInProgress) {
          loadSavedCard(false);
        }
      });

      document.addEventListener("DOMContentLoaded", async () => {
        const recoveryToken = recoveryTokenFromUrl();

        if (recoveryToken) clearRecoveryTokenFromUrl();

        try {
          if (recoveryToken) {
            try {
              await restoreCardFromLink(recoveryToken);
            } catch (error) {
              showRegistration(
                error.message || "The card recovery link could not be used.",
                "error",
              );
            }
          } else {
            await loadSavedCard(false);
          }
        } finally {
          $("appLoading").classList.add("hidden");
        }
      });
    
