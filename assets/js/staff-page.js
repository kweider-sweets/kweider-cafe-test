      "use strict";

      const SUPABASE_URL = "https://fwjiceleybxhgetsvsvp.supabase.co";

      // REQUIRED: replace only the text between the quotation marks below.
      const SUPABASE_PUBLISHABLE_KEY =
        "sb_publishable_yNgSShCyeQ6FfSy30T6-hg_9dLXXpwk";

      const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/kweider-rewards-api`;
      const SESSION_KEY = "kweiderRewards.staffSession.v1";
      const $ = (id) => document.getElementById(id);

      let session = null;
      let staff = null;
      let member = null;
      let memberTransactions = [];
      let memberRewards = [];
      let pinResetRequest = null;
      let rewardDefinitions = [];
      let settings = {
        pointsPerPound: 1,
        pointsPerReward: 100,
        rewardValue: 5,
      };
      let qrScanner = null;
      let scanning = false;
      let scanHandled = false;

      let pendingQrRewardId = "";
      let quickSelectedRewardId = "";
      let quickSelectionFromCustomer = false;
      let pendingCheckoutRequest = null;

      function hasConfiguration() {
        return SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_");
      }

      function message(targetId, text, type = "info") {
        $(targetId).innerHTML = text
          ? `<div class="notice ${type}">${escapeHtml(text)}</div>`
          : "";
      }

      function escapeHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
      }

      function readField(object, ...keys) {
        for (const key of keys) {
          if (object && object[key] !== undefined && object[key] !== null) {
            return object[key];
          }
        }
        return null;
      }

      function createIdempotencyKey() {
        if (globalThis.crypto?.randomUUID)
          return globalThis.crypto.randomUUID();

        if (globalThis.crypto?.getRandomValues) {
          const bytes = new Uint8Array(16);
          globalThis.crypto.getRandomValues(bytes);
          bytes[6] = (bytes[6] & 0x0f) | 0x40;
          bytes[8] = (bytes[8] & 0x3f) | 0x80;
          const hex = Array.from(bytes, (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
          return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        }

        throw new Error("Secure random generation is unavailable.");
      }

      function checkoutRequestFingerprint(plan) {
        const welcomeCoffeeToggle = $("quickWelcomeCoffeeConfirmed");
        return JSON.stringify({
          memberId: String(member?.id || ""),
          billAmount: Number(plan.billAmount),
          selectedRewardId: String(plan.selectedRewardId || ""),
          breakfastConfirmed: $("quickBreakfastConfirmed").checked === true,
          welcomeCoffeeConfirmed: Boolean(welcomeCoffeeToggle?.checked),
          receiptReference: $("quickReceipt").value.trim(),
        });
      }

      function checkoutRequestKey(plan) {
        const fingerprint = checkoutRequestFingerprint(plan);
        if (!pendingCheckoutRequest || pendingCheckoutRequest.fingerprint !== fingerprint) {
          pendingCheckoutRequest = { fingerprint, key: createIdempotencyKey() };
        }
        return pendingCheckoutRequest.key;
      }

      function isRewardAvailable(reward) {
        if (!reward || readField(reward, "status") !== "available")
          return false;
        const expiresAt = readField(reward, "expiresAt", "expires_at");
        if (!expiresAt) return true;
        const expiryTime = new Date(expiresAt).getTime();
        return Number.isFinite(expiryTime) && expiryTime > Date.now();
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

      function definitionForReward(reward) {
        const embedded = embeddedDefinitionOf(reward);
        if (embedded) return embedded;

        const definitionId = rewardDefinitionIdOf(reward);
        if (definitionId) {
          const byId = rewardDefinitions.find(
            (definition) => definitionIdOf(definition) === definitionId,
          );
          if (byId) return byId;
        }

        const code = rewardCodeOf(reward);
        if (code) {
          const byCode = rewardDefinitions.find(
            (definition) => definitionCodeOf(definition) === code,
          );
          if (byCode) return byCode;
        }

        return null;
      }

      function rewardTitle(definition, reward = null) {
        const code =
          definitionCodeOf(definition) || rewardCodeOf(reward);
        const fallbackTitles = {
          discount_3: "£5 Off Your Next Bill",
          discount_5: "£5 Off Your Next Bill",
          breakfast_for_two: "Breakfast for Two",
        };

        return String(
          readField(definition, "titleEn", "title_en") ||
            fallbackTitles[code] ||
            code ||
            "Reward",
        );
      }

      function selectedRewardDetails() {
        const select = $("memberReward");
        const memberRewardId = select.value;
        const reward =
          memberRewards.find(
            (item) => String(readField(item, "id") || "") === memberRewardId,
          ) || null;
        const definition = reward ? definitionForReward(reward) : null;
        return { memberRewardId, reward, definition };
      }

      function rewardKindOf(definition, reward = null) {
        return String(
          readField(definition, "rewardKind", "reward_kind", "kind") ||
            readField(embeddedDefinitionOf(reward), "rewardKind", "reward_kind", "kind") ||
            "",
        );
      }

      function fixedRewardAmount(definition, reward = null) {
        const code = definitionCodeOf(definition) || rewardCodeOf(reward);
        const configured = Number(
          readField(definition, "maximumDiscount", "maximum_discount"),
        );

        if (code === "discount_3") {
          return Number.isFinite(configured) && configured > 0 ? configured : 5;
        }
        if (code === "discount_5") {
          return Number.isFinite(configured) && configured > 0 ? configured : 5;
        }
        return null;
      }

      function calculateFixedReward(definition, reward, purchaseAmount) {
        const rewardAmount = fixedRewardAmount(definition, reward) || 0;
        const billAmount = Number(purchaseAmount);
        const discount = Math.min(
          Math.max(0, rewardAmount),
          Math.max(0, Number.isFinite(billAmount) ? billAmount : 0),
        );
        return {
          rewardAmount,
          discount: Math.round((discount + Number.EPSILON) * 100) / 100,
        };
      }

      function calculateDiscount(definition, purchaseAmount) {
        const percent = Number(
          readField(definition, "percentOff", "percent_off") || 0,
        );
        const maximumRaw = readField(
          definition,
          "maximumDiscount",
          "maximum_discount",
        );
        const maximum =
          maximumRaw === null || maximumRaw === "" ? null : Number(maximumRaw);
        const rawDiscount = (Number(purchaseAmount) * percent) / 100;
        const discount =
          Number.isFinite(maximum) && maximum >= 0
            ? Math.min(rawDiscount, maximum)
            : rawDiscount;
        return {
          percent,
          maximum,
          discount: Math.max(
            0,
            Math.round((discount + Number.EPSILON) * 100) / 100,
          ),
        };
      }


      function parseCustomerQr(value) {
        const raw = String(value || "").trim();
        const withoutPrefix = raw
          .replace(/^KWEIDER-LOYALTY:/i, "")
          .replace(/^KWEIDER-REWARDS:/i, "");
        const parts = withoutPrefix.split("|");
        const search = String(parts.shift() || "").trim();
        let memberRewardId = "";

        for (const part of parts) {
          const match = String(part).match(/^MR:([0-9a-f-]{36})$/i);
          if (match) {
            memberRewardId = match[1].toLowerCase();
            break;
          }
        }

        return { raw, search, memberRewardId };
      }

      function quickAvailableRewards() {
        return memberRewards.filter(isRewardAvailable);
      }

      function quickRewardById(memberRewardId) {
        return (
          quickAvailableRewards().find(
            (reward) =>
              String(readField(reward, "id") || "") ===
              String(memberRewardId || ""),
          ) || null
        );
      }

      function fixedRewardCandidate(reward) {
        const definition = definitionForReward(reward);
        const amount = fixedRewardAmount(definition, reward);
        return amount === null
          ? null
          : { reward, definition, amount };
      }

      function bestFixedRewardThatFits(billAmount) {
        return quickAvailableRewards()
          .map(fixedRewardCandidate)
          .filter(
            (candidate) =>
              candidate &&
              candidate.amount > 0 &&
              candidate.amount <= billAmount,
          )
          .sort((left, right) => right.amount - left.amount)[0] || null;
      }

      function bestAvailableFixedReward() {
        return quickAvailableRewards()
          .map(fixedRewardCandidate)
          .filter(Boolean)
          .sort((left, right) => right.amount - left.amount)[0] || null;
      }

      function quickSelectedDetails() {
        const reward = quickRewardById(quickSelectedRewardId);
        const definition = reward ? definitionForReward(reward) : null;
        return {
          reward,
          definition,
          kind: reward ? rewardKindOf(definition, reward) : "",
          title: reward ? rewardTitle(definition, reward) : "",
          fixedAmount: reward ? fixedRewardAmount(definition, reward) : null,
        };
      }

      function checkoutPlan() {
        const amount = Number($("quickPurchaseAmount").value);
        const pointsPerPound = Number(settings.pointsPerPound || 1);
        const selected = quickSelectedDetails();

        if (!Number.isFinite(amount) || amount < 0) {
          return {
            valid: false,
            message: "Enter a valid bill amount.",
          };
        }

        if (selected.kind === "breakfast_for_two") {
          if (!$("quickBreakfastConfirmed").checked) {
            return {
              valid: false,
              breakfast: true,
              message:
                "Confirm that the order contains the eligible Breakfast for Two.",
            };
          }

          return {
            valid: true,
            breakfast: true,
            selectedRewardId: quickSelectedRewardId,
            rewardTitle: selected.title,
            billAmount: amount,
            discountAmount: null,
            amountPaid: amount,
            pointsAdded: Math.floor(amount * pointsPerPound),
            note:
              "For breakfast rewards, this amount must be what the customer pays after the free breakfast is removed.",
          };
        }

        if (amount <= 0) {
          return {
            valid: false,
            message: "Enter the bill amount.",
          };
        }

        if (selected.reward) {
          if (
            selected.fixedAmount !== null &&
            amount >= selected.fixedAmount
          ) {
            const amountPaid =
              Math.round(
                (amount - selected.fixedAmount + Number.EPSILON) * 100,
              ) / 100;
            return {
              valid: true,
              selectedRewardId: quickSelectedRewardId,
              rewardTitle: selected.title,
              billAmount: amount,
              discountAmount: selected.fixedAmount,
              amountPaid,
              pointsAdded: Math.floor(amountPaid * pointsPerPound),
            };
          }

          const fallback = bestFixedRewardThatFits(amount);
          if (fallback) {
            const amountPaid =
              Math.round(
                (amount - fallback.amount + Number.EPSILON) * 100,
              ) / 100;
            return {
              valid: true,
              selectedRewardId: quickSelectedRewardId,
              rewardTitle: rewardTitle(
                fallback.definition,
                fallback.reward,
              ),
              billAmount: amount,
              discountAmount: fallback.amount,
              amountPaid,
              pointsAdded: Math.floor(amountPaid * pointsPerPound),
              fallback: true,
              note:
                "The selected reward is larger than this bill. The best smaller reward will be used instead.",
            };
          }

          return {
            valid: true,
            selectedRewardId: quickSelectedRewardId,
            rewardTitle: "",
            billAmount: amount,
            discountAmount: 0,
            amountPaid: amount,
            pointsAdded: Math.floor(amount * pointsPerPound),
            rewardSkipped: true,
            note:
              "The selected reward is larger than this bill, so it will stay available for later.",
          };
        }

        return {
          valid: true,
          selectedRewardId: null,
          rewardTitle: "",
          billAmount: amount,
          discountAmount: 0,
          amountPaid: amount,
          pointsAdded: Math.floor(amount * pointsPerPound),
        };
      }

      function renderQuickCheckout() {
        if (!member) return;

        const selected = quickSelectedDetails();
        const hasReward = Boolean(selected.reward);
        const breakfast = selected.kind === "breakfast_for_two";

        $("quickRewardChoice").textContent = hasReward
          ? selected.title
          : "No reward selected";
        $("quickRewardChoiceNote").textContent = hasReward
          ? quickSelectionFromCustomer
            ? "Selected on the customer phone · اختيار العميل"
            : "Selected by staff · تم اختيارها من الموظف"
          : "Points will be added only · ستضاف النقاط فقط";

        $("quickBreakfastConfirmationRow").classList.toggle(
          "hidden",
          !breakfast,
        );
        $("quickAmountLabel").textContent = breakfast
          ? "Amount customer pays after breakfast reward (£)"
          : "Bill amount before reward (£)";
        $("quickAmountHint").textContent = breakfast
          ? "Enter the final amount payable after the eligible breakfast has been removed."
          : "Enter the till total before applying a £5 reward.";

        const plan = checkoutPlan();
        const preview = $("quickCheckoutPreview");

        if (!plan.valid) {
          preview.className =
            "notice info quick-checkout-preview";
          preview.textContent = plan.message;
          $("completeCheckout").disabled = true;
          return;
        }

        const rewardLine = plan.breakfast
          ? `${plan.rewardTitle} will be used`
          : plan.discountAmount > 0
            ? `${plan.rewardTitle} · £${plan.discountAmount.toFixed(2)} off`
            : plan.rewardSkipped
              ? "Reward kept for later"
              : "No reward used";

        preview.className =
          "notice ok quick-checkout-preview";
        preview.innerHTML = `
          <div class="quick-checkout-summary">
            <span>Bill / entered amount</span>
            <strong>£${plan.billAmount.toFixed(2)}</strong>
            <span>Reward</span>
            <strong>${escapeHtml(rewardLine)}</strong>
            <span>Points added</span>
            <strong>${plan.pointsAdded}</strong>
            <span class="payable">Customer pays</span>
            <strong class="payable-value">£${plan.amountPaid.toFixed(2)}</strong>
          </div>
          ${plan.note ? `<div class="field-hint" style="margin-top:10px">${escapeHtml(plan.note)}</div>` : ""}
        `;
        $("completeCheckout").disabled = false;
      }

      function prepareQuickCheckout() {
        const availableIds = new Set(
          quickAvailableRewards().map((reward) =>
            String(readField(reward, "id") || ""),
          ),
        );

        if (
          pendingQrRewardId &&
          availableIds.has(pendingQrRewardId)
        ) {
          quickSelectedRewardId = pendingQrRewardId;
          quickSelectionFromCustomer = true;
        } else if (
          !availableIds.has(quickSelectedRewardId)
        ) {
          quickSelectedRewardId = "";
          quickSelectionFromCustomer = false;
        }

        $("quickPurchaseAmount").value = "";
        $("quickReceipt").value = "";
        $("quickBreakfastConfirmed").checked = false;
        $("quickCheckoutResult").innerHTML = "";
        renderQuickCheckout();

        setTimeout(() => {
          $("quickPurchaseAmount").focus();
        }, 80);
      }

      function syncRedeemButton() {
        $("redeemReward").disabled = !$("memberReward").value;
      }

      function updateRewardPreview() {
        const { reward, definition } = selectedRewardDetails();
        const preview = $("rewardPreview");
        const purchaseInput = $("redeemPurchaseAmount");

        if (!reward || !definition) {
          purchaseInput.required = false;
          preview.className = "notice info reward-preview";
          preview.textContent = "Select an available reward.";
          syncRedeemButton();
          return;
        }

        const title = rewardTitle(definition, reward);
        const kind = rewardKindOf(definition, reward);

        const fixedAmount = fixedRewardAmount(definition, reward);

        if (fixedAmount !== null) {
          purchaseInput.required = true;
          const amount = Number(purchaseInput.value);

          if (!Number.isFinite(amount) || amount <= 0) {
            preview.className = "notice info reward-preview";
            preview.textContent = `${title}: enter the bill amount to confirm the discount.`;
          } else {
            const { rewardAmount, discount } = calculateFixedReward(
              definition,
              reward,
              amount,
            );
            const limitedText =
              amount < rewardAmount
                ? " The discount cannot exceed the bill total."
                : "";
            preview.className = "notice ok reward-preview";
            preview.textContent = `${title}: apply £${discount.toFixed(2)} off this £${amount.toFixed(2)} bill.${limitedText}`;
          }
        } else if (kind === "percent_discount") {
          purchaseInput.required = true;
          const amount = Number(purchaseInput.value);
          const { percent, maximum, discount } = calculateDiscount(
            definition,
            amount,
          );

          if (!Number.isFinite(amount) || amount <= 0) {
            preview.className = "notice info reward-preview";
            preview.textContent = `${title}: enter the purchase amount to calculate the discount.`;
          } else {
            const capText = Number.isFinite(maximum)
              ? ` (maximum £${maximum.toFixed(2)})`
              : "";
            preview.className = "notice ok reward-preview";
            preview.textContent = `${title}: ${percent}% discount = £${discount.toFixed(2)} on a £${amount.toFixed(2)} purchase${capText}.`;
          }
        } else if (kind === "breakfast_for_two") {
          purchaseInput.required = false;
          preview.className = "notice ok reward-preview";
          preview.textContent = `${title}: redeem the selected breakfast for two. A purchase amount is not required.`;
        } else {
          purchaseInput.required = false;
          preview.className = "notice info reward-preview";
          preview.textContent = title;
        }

        syncRedeemButton();
      }

      function setBusy(button, busy, busyText) {
        if (!button.dataset.normalText)
          button.dataset.normalText = button.textContent;
        button.disabled = busy;
        button.classList.toggle("button-busy", busy);
        button.textContent = busy ? busyText : button.dataset.normalText;
      }

      function saveSession(nextSession) {
        session = nextSession;
        if (nextSession)
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
        else sessionStorage.removeItem(SESSION_KEY);
      }

      function loadSession() {
        try {
          const raw = sessionStorage.getItem(SESSION_KEY);
          session = raw ? JSON.parse(raw) : null;
        } catch {
          session = null;
          sessionStorage.removeItem(SESSION_KEY);
        }
      }

      async function readJson(response) {
        const text = await response.text();
        if (!text) return {};
        try {
          return JSON.parse(text);
        } catch {
          return { message: text };
        }
      }

      async function authRequest(path, body, accessToken = "") {
        const headers = {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        };
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

        const response = await fetch(`${SUPABASE_URL}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const data = await readJson(response);
        if (!response.ok)
          throw new Error(
            data.message ||
              data.error_description ||
              data.error ||
              "Authentication failed.",
          );
        return data;
      }

      async function signIn(email, password) {
        const data = await authRequest("/auth/v1/token?grant_type=password", {
          email,
          password,
        });
        if (!data.access_token || !data.refresh_token)
          throw new Error("The staff session could not be created.");
        saveSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at:
            data.expires_at ||
            Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
          user: data.user || null,
        });
      }

      async function refreshSession() {
        if (!session?.refresh_token)
          throw new Error("The staff session has expired. Sign in again.");
        const data = await authRequest(
          "/auth/v1/token?grant_type=refresh_token",
          {
            refresh_token: session.refresh_token,
          },
        );
        if (!data.access_token || !data.refresh_token)
          throw new Error("The staff session has expired. Sign in again.");
        saveSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at:
            data.expires_at ||
            Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
          user: data.user || session.user || null,
        });
      }

      async function ensureFreshSession() {
        if (!session?.access_token)
          throw new Error("Sign in with an authorised staff account.");
        const expiresAt = Number(session.expires_at || 0);
        if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + 60)
          await refreshSession();
      }

      async function apiRequest(payload, allowRefresh = true) {
        await ensureFreshSession();
        const response = await fetch(FUNCTION_URL, {
          method: "POST",
          headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const data = await readJson(response);

        if (response.status === 401 && allowRefresh && session?.refresh_token) {
          await refreshSession();
          return apiRequest(payload, false);
        }

        if (!response.ok || data.ok === false) {
          const error = new Error(
            data.message || "The rewards request failed.",
          );
          error.code = data.code || "";
          error.status = response.status;
          throw error;
        }
        return data;
      }

      function resetMember() {
        pendingCheckoutRequest = null;
        member = null;
        memberTransactions = [];
        memberRewards = [];
        pinResetRequest = null;
        rewardDefinitions = [];
        pendingQrRewardId = "";
        quickSelectedRewardId = "";
        quickSelectionFromCustomer = false;
        $("memberPanel").classList.add("hidden");
        $("transactionList").innerHTML = "";
        $("memberReward").innerHTML =
          '<option value="">No rewards available</option>';
        $("redeemPurchaseAmount").value = "";
        $("redeemReceipt").value = "";
        $("quickPurchaseAmount").value = "";
        $("quickReceipt").value = "";
        $("quickBreakfastConfirmed").checked = false;
        $("quickCheckoutResult").innerHTML = "";
        $("recoveryLink").value = "";
        $("recoveryExpiry").textContent = "";
        $("recoveryLinkBox").classList.add("hidden");
        $("copyRecoveryLink").classList.add("hidden");
        $("pinResetApprovalCard").classList.add("hidden");
        $("pinResetApprovedNote").classList.add("hidden");
        $("approvePinReset").classList.remove("hidden");
        $("pinResetRequestTime").textContent = "";
        updateRewardPreview();
      }

      function renderStaff() {
        $("signedInName").textContent = staff?.displayName || "Staff";
        $("signedInRole").textContent = staff?.role
          ? `Role: ${staff.role}`
          : "";
        $("loginCard").classList.add("hidden");
        $("staffPanel").classList.remove("hidden");
      }

      function renderRewardOptions(rewards, definitions) {
        const select = $("memberReward");
        select.innerHTML = "";

        const lookupDefinitions = Array.isArray(definitions)
          ? definitions
          : [];

        const findDefinition = (reward) => {
          const embedded = embeddedDefinitionOf(reward);
          if (embedded) return embedded;

          const definitionId = rewardDefinitionIdOf(reward);
          if (definitionId) {
            const byId = lookupDefinitions.find(
              (definition) => definitionIdOf(definition) === definitionId,
            );
            if (byId) return byId;
          }

          const code = rewardCodeOf(reward);
          return (
            lookupDefinitions.find(
              (definition) => definitionCodeOf(definition) === code,
            ) || null
          );
        };

        const availableRewards = (rewards || [])
          .filter(isRewardAvailable)
          .sort((left, right) => {
            const leftDefinition = findDefinition(left);
            const rightDefinition = findDefinition(right);
            return (
              Number(
                readField(
                  leftDefinition,
                  "thresholdPoints",
                  "threshold_points",
                ) || 0,
              ) -
              Number(
                readField(
                  rightDefinition,
                  "thresholdPoints",
                  "threshold_points",
                ) || 0,
              )
            );
          });

        if (!availableRewards.length) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = "No rewards available";
          select.appendChild(option);
          updateRewardPreview();
          return;
        }

        availableRewards.forEach((reward) => {
          const definition = findDefinition(reward);
          const title = rewardTitle(definition, reward);
          const expiresAt = readField(reward, "expiresAt", "expires_at");
          const expiryTime = expiresAt ? new Date(expiresAt).getTime() : NaN;
          const expiryText = Number.isFinite(expiryTime)
            ? ` · valid until ${new Date(expiryTime).toLocaleDateString("en-GB")}`
            : "";

          const option = document.createElement("option");
          option.value = String(readField(reward, "id") || "");
          option.textContent = `${title}${expiryText}`;
          select.appendChild(option);
        });

        updateRewardPreview();
      }

      function renderTransactions(transactions) {
        const list = $("transactionList");
        if (!transactions?.length) {
          list.innerHTML =
            '<div class="notice info">No activity recorded yet.</div>';
          return;
        }

        list.innerHTML = transactions
          .map((transaction) => {
            const points = Number(transaction.pointsDelta || 0);
            const isRedeem = transaction.type === "redeem" || points < 0;
            const title = isRedeem
              ? `Reward redeemed${transaction.rewardValue ? ` · £${Number(transaction.rewardValue).toFixed(2)}` : ""}`
              : `Purchase points${transaction.purchaseAmount !== null ? ` · £${Number(transaction.purchaseAmount).toFixed(2)}` : ""}`;
            const date = transaction.createdAt
              ? new Date(transaction.createdAt).toLocaleString("en-GB")
              : "";
            const details = [
              transaction.receiptReference,
              transaction.performedByName,
              date,
            ]
              .filter(Boolean)
              .join(" · ");
            const pointsText = `${points > 0 ? "+" : ""}${points} pts`;
            return `
          <div class="transaction-item">
            <div>
              <strong>${escapeHtml(title)}</strong>
              <small>${escapeHtml(details || transaction.notes || "")}</small>
            </div>
            <div class="transaction-points ${points < 0 ? "negative" : "positive"}">${escapeHtml(pointsText)}</div>
          </div>`;
          })
          .join("");
      }

      function renderMember(bundle) {
        member = bundle.member;
        memberTransactions = Array.isArray(bundle.transactions)
          ? bundle.transactions
          : [];
        const rewardsPayload =
          bundle.rewards || bundle.memberRewards || bundle.member_rewards;
        const definitionsPayload =
          bundle.rewardDefinitions ||
          bundle.reward_definitions ||
          bundle.definitions;

        memberRewards = Array.isArray(rewardsPayload) ? rewardsPayload : [];
        rewardDefinitions = Array.isArray(definitionsPayload)
          ? definitionsPayload
          : [];
        settings = bundle.settings || settings;
        pinResetRequest = bundle.pinResetRequest || bundle.pin_reset_request || null;

        const availableRewards = memberRewards.filter(isRewardAvailable);
        const availableTitles = availableRewards
          .map((reward) => rewardTitle(definitionForReward(reward), reward))
          .filter(Boolean);

        $("memberPanel").classList.remove("hidden");
        $("staffMemberName").textContent = member.firstName || "Member";
        $("staffMemberMeta").textContent =
          `${member.memberCode} · ${member.phone}`;
        $("staffPoints").textContent = Number(member.points || 0);
        $("staffRewardSummary").textContent = availableRewards.length
          ? `${availableRewards.length} reward${availableRewards.length === 1 ? "" : "s"} available: ${availableTitles.join(", ")}`
          : "No rewards available yet.";

        const resetStatus = String(pinResetRequest?.status || "");
        const showReset = resetStatus === "pending" || resetStatus === "approved";
        $("pinResetApprovalCard").classList.toggle("hidden", !showReset);
        $("approvePinReset").classList.toggle("hidden", resetStatus !== "pending");
        $("pinResetApprovedNote").classList.toggle("hidden", resetStatus !== "approved");
        if (showReset) {
          const requestedAt = pinResetRequest?.requestedAt
            ? new Date(pinResetRequest.requestedAt).toLocaleString("en-GB")
            : "just now";
          const expiresAt = pinResetRequest?.expiresAt
            ? new Date(pinResetRequest.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
            : "soon";
          $("pinResetRequestTime").textContent = `Requested ${requestedAt} · expires ${expiresAt}`;
        } else {
          $("pinResetRequestTime").textContent = "";
        }

        $("recoveryLink").value = "";
        $("recoveryExpiry").textContent = "";
        $("recoveryLinkBox").classList.add("hidden");
        $("copyRecoveryLink").classList.add("hidden");

        renderRewardOptions(memberRewards, rewardDefinitions);
        renderTransactions(memberTransactions);
        prepareQuickCheckout();
      }

      function cleanMemberSearch(value) {
        return parseCustomerQr(value).search;
      }

      async function findMember(value) {
        const search = cleanMemberSearch(value);
        if (!search)
          throw new Error("Enter a membership code or phone number.");
        const data = await apiRequest({
          action: "staff_find_member",
          memberSearch: search,
        });
        renderMember(data);
        message(
          "staffMessage",
          "Member found. Check the name before continuing.",
          "ok",
        );
      }

      async function stopCamera() {
        scanning = false;
        scanHandled = false;

        if (qrScanner) {
          try {
            await qrScanner.stop();
          } catch {}
          try {
            qrScanner.clear();
          } catch {}
          qrScanner = null;
        }

        $("scanArea").classList.add("hidden");
        $("qrReader").innerHTML = "";
        $("scanQr").disabled = false;
      }

      $("staffLogin").addEventListener("click", async () => {
        const button = $("staffLogin");
        const email = $("staffEmail").value.trim();
        const password = $("staffPassword").value;
        message("loginMessage", "");

        if (!email || !password) {
          message(
            "loginMessage",
            "Enter the staff email and password.",
            "error",
          );
          return;
        }

        setBusy(button, true, "Signing in...");
        try {
          await signIn(email, password);
          const data = await apiRequest({ action: "staff_me" });
          staff = data.staff;
          $("staffPassword").value = "";
          renderStaff();
        } catch (error) {
          saveSession(null);
          message("loginMessage", error.message || "Sign-in failed.", "error");
        } finally {
          setBusy(button, false, "Signing in...");
        }
      });

      $("staffPassword").addEventListener("keydown", (event) => {
        if (event.key === "Enter") $("staffLogin").click();
      });

      $("staffLogout").addEventListener("click", async () => {
        const token = session?.access_token || "";
        try {
          if (token) await authRequest("/auth/v1/logout", {}, token);
        } catch {}
        await stopCamera();
        saveSession(null);
        staff = null;
        resetMember();
        $("staffPanel").classList.add("hidden");
        $("loginCard").classList.remove("hidden");
        message("loginMessage", "Signed out successfully.", "ok");
      });

      $("findMember").addEventListener("click", async () => {
        const button = $("findMember");
        setBusy(button, true, "Searching...");
        message("staffMessage", "");
        try {
          pendingQrRewardId = "";
          quickSelectedRewardId = "";
          quickSelectionFromCustomer = false;
          await findMember($("memberSearch").value);
        } catch (error) {
          resetMember();
          message(
            "staffMessage",
            error.message || "Member search failed.",
            "error",
          );
        } finally {
          setBusy(button, false, "Searching...");
        }
      });

      $("memberSearch").addEventListener("keydown", (event) => {
        if (event.key === "Enter") $("findMember").click();
      });


      $("quickPurchaseAmount").addEventListener(
        "input",
        renderQuickCheckout,
      );
      $("quickBreakfastConfirmed").addEventListener(
        "change",
        renderQuickCheckout,
      );

      $("completeCheckout").addEventListener(
        "click",
        async () => {
          if (!member) return;

          const plan = checkoutPlan();
          if (!plan.valid) {
            renderQuickCheckout();
            return;
          }

          const button = $("completeCheckout");
          setBusy(button, true, "Completing...");
          message("staffMessage", "");

          try {
            const data = await apiRequest({
              action: "staff_complete_checkout",
              memberId: member.id,
              purchaseAmount: plan.billAmount,
              memberRewardId:
                plan.selectedRewardId || null,
              breakfastConfirmed:
                $("quickBreakfastConfirmed").checked,
              receiptReference:
                $("quickReceipt").value.trim() || null,
              idempotencyKey: checkoutRequestKey(plan),
            });

            const operation = data.operation || {};
            const reward = readField(operation, "reward");
            const rewardTitleText = String(
              readField(reward, "titleEn", "title_en") || "",
            );
            const discountAmount = Number(
              readField(
                operation,
                "discountAmount",
                "discount_amount",
              ) || 0,
            );
            const amountPaid = Number(
              readField(operation, "amountPaid", "amount_paid") ||
                plan.amountPaid ||
                0,
            );
            const pointsAdded = Number(
              readField(operation, "pointsAdded", "points_added") ||
                0,
            );
            const newBalance = Number(
              readField(
                operation,
                "newPointsBalance",
                "new_points_balance",
              ) || data.member?.points || 0,
            );
            const fallbackApplied = Boolean(
              readField(
                operation,
                "fallbackApplied",
                "fallback_applied",
              ),
            );
            const rewardUsed = Boolean(
              readField(operation, "rewardUsed", "reward_used"),
            );

            pendingQrRewardId = "";
            quickSelectedRewardId = "";
            quickSelectionFromCustomer = false;
            renderMember(data);

            const rewardLine = rewardUsed
              ? `${escapeHtml(rewardTitleText || "Reward")} used${
                  discountAmount > 0
                    ? ` · £${discountAmount.toFixed(2)} off`
                    : ""
                }`
              : "No reward used";

            $("quickCheckoutResult").innerHTML = `
              <div class="checkout-result">
                <strong>Checkout completed ✓ · تمت العملية</strong>
                <div class="quick-checkout-summary" style="margin-top:10px">
                  <span>Reward</span>
                  <strong>${rewardLine}</strong>
                  <span>Customer pays</span>
                  <strong>£${amountPaid.toFixed(2)}</strong>
                  <span>Points added</span>
                  <strong>${pointsAdded}</strong>
                  <span>New balance</span>
                  <strong>${newBalance} pts</strong>
                </div>
                ${
                  fallbackApplied
                    ? '<div class="field-hint" style="margin-top:9px">A smaller suitable reward was used automatically.</div>'
                    : ""
                }
                <button
                  type="button"
                  class="gold-btn"
                  data-scan-next
                  style="width:100%;margin-top:14px"
                >
                  Scan next customer · مسح العميل التالي
                </button>
              </div>`;

            message(
              "staffMessage",
              "Checkout completed successfully.",
              "ok",
            );
            pendingCheckoutRequest = null;
          } catch (error) {
            message(
              "staffMessage",
              error.message ||
                "The checkout could not be completed.",
              "error",
            );
          } finally {
            setBusy(button, false, "Completing...");
            renderQuickCheckout();
          }
        },
      );

      $("quickCheckoutResult").addEventListener(
        "click",
        async (event) => {
          const button = event.target.closest("[data-scan-next]");
          if (!button) return;

          pendingQrRewardId = "";
          quickSelectedRewardId = "";
          quickSelectionFromCustomer = false;
          $("memberSearch").value = "";
          resetMember();
          message("staffMessage", "");
          await startQrScanner();
        },
      );

      $("approvePinReset").addEventListener("click", async () => {
        if (!member || !pinResetRequest || pinResetRequest.status !== "pending") return;

        const confirmed = confirm(
          `Approve the PIN reset for ${member.firstName}? The customer will be able to create a new PIN for this card.`,
        );
        if (!confirmed) return;

        const button = $("approvePinReset");
        setBusy(button, true, "Approving...");
        message("staffMessage", "");
        try {
          const data = await apiRequest({
            action: "staff_approve_pin_reset",
            memberId: member.id,
          });
          renderMember(data);
          message(
            "staffMessage",
            "PIN reset approved. The customer can now create a new PIN on their phone.",
            "ok",
          );
        } catch (error) {
          message(
            "staffMessage",
            error.message || "The PIN reset could not be approved.",
            "error",
          );
        } finally {
          setBusy(button, false, "Approving...");
        }
      });

      $("generateRecoveryLink").addEventListener("click", async () => {
        if (!member) return;

        const confirmed = confirm(
          `Generate a 15-minute recovery link for ${member.firstName}? Once the customer opens it, all older saved cards for this membership will be signed out.`,
        );

        if (!confirmed) return;

        const button = $("generateRecoveryLink");
        setBusy(button, true, "Generating...");
        message("staffMessage", "");

        try {
          const data = await apiRequest({
            action: "staff_issue_recovery_token",
            memberId: member.id,
          });

          if (!data.recoveryToken) {
            throw new Error("The recovery token was not returned.");
          }

          const recoveryUrl = new URL("rewards.html", window.location.href);
          recoveryUrl.hash = `recover=${encodeURIComponent(data.recoveryToken)}`;

          $("recoveryLink").value = recoveryUrl.toString();
          $("recoveryLinkBox").classList.remove("hidden");
          $("copyRecoveryLink").classList.remove("hidden");

          const expiry = data.expiresAt
            ? new Date(data.expiresAt).toLocaleString("en-GB")
            : "15 minutes from now";
          $("recoveryExpiry").textContent = `Valid until ${expiry}. Share it directly with the customer.`;

          message(
            "staffMessage",
            "Recovery link generated. Copy it and send it directly to the customer.",
            "ok",
          );
        } catch (error) {
          message(
            "staffMessage",
            error.message || "The recovery link could not be generated.",
            "error",
          );
        } finally {
          setBusy(button, false, "Generating...");
        }
      });

      $("copyRecoveryLink").addEventListener("click", async () => {
        const link = $("recoveryLink").value;
        if (!link) return;

        try {
          await navigator.clipboard.writeText(link);
        } catch {
          $("recoveryLink").focus();
          $("recoveryLink").select();
          document.execCommand("copy");
        }

        message("staffMessage", "Recovery link copied.", "ok");
      });

      $("addPoints").addEventListener("click", async () => {
        if (!member) return;
        const button = $("addPoints");
        const purchaseAmount = Number($("purchaseAmount").value);
        const receiptReference = $("earnReceipt").value.trim();

        if (!Number.isFinite(purchaseAmount) || purchaseAmount <= 0) {
          message("staffMessage", "Enter a valid purchase amount.", "error");
          return;
        }
        if (!receiptReference) {
          message("staffMessage", "Receipt number is required.", "error");
          return;
        }

        setBusy(button, true, "Adding...");
        try {
          const data = await apiRequest({
            action: "staff_add_purchase_points",
            memberId: member.id,
            purchaseAmount,
            receiptReference,
            idempotencyKey: createIdempotencyKey(),
          });
          renderMember(data);
          $("purchaseAmount").value = "";
          $("earnReceipt").value = "";
          const duplicateText = data.operation?.duplicate
            ? " This request had already been recorded."
            : "";
          message(
            "staffMessage",
            `${Number(data.operation?.pointsAdded || 0)} points added successfully.${duplicateText}`,
            "ok",
          );
        } catch (error) {
          message(
            "staffMessage",
            error.message || "Points could not be added.",
            "error",
          );
        } finally {
          setBusy(button, false, "Adding...");
        }
      });

      $("memberReward").addEventListener("change", updateRewardPreview);
      $("redeemPurchaseAmount").addEventListener("input", updateRewardPreview);

      $("redeemReward").addEventListener("click", async () => {
        if (!member) return;

        const { memberRewardId, reward, definition } = selectedRewardDetails();
        const rawPurchaseAmount = $("redeemPurchaseAmount").value.trim();
        const purchaseAmount =
          rawPurchaseAmount === "" ? null : Number(rawPurchaseAmount);
        const receiptReference = $("redeemReceipt").value.trim();

        if (!memberRewardId || !reward || !definition) {
          message(
            "staffMessage",
            "The member does not have an available reward.",
            "error",
          );
          return;
        }

        const kind = rewardKindOf(definition, reward);
        const title = rewardTitle(definition, reward);

        const fixedAmount = fixedRewardAmount(definition, reward);
        const needsBillAmount =
          fixedAmount !== null || kind === "percent_discount";

        if (
          needsBillAmount &&
          (purchaseAmount === null ||
            !Number.isFinite(purchaseAmount) ||
            purchaseAmount <= 0)
        ) {
          message(
            "staffMessage",
            "Enter the bill amount to confirm the discount.",
            "error",
          );
          $("redeemPurchaseAmount").focus();
          return;
        }

        if (
          purchaseAmount !== null &&
          (!Number.isFinite(purchaseAmount) || purchaseAmount <= 0)
        ) {
          message("staffMessage", "Enter a valid purchase amount.", "error");
          $("redeemPurchaseAmount").focus();
          return;
        }

        let confirmationText = `Redeem ${title} for ${member.firstName}?`;
        if (fixedAmount !== null) {
          const { discount } = calculateFixedReward(
            definition,
            reward,
            purchaseAmount,
          );
          confirmationText += `
Discount to apply: £${discount.toFixed(2)}.`;
        } else if (kind === "percent_discount") {
          const { discount } = calculateDiscount(definition, purchaseAmount);
          confirmationText += `
Discount to apply: £${discount.toFixed(2)}.`;
        }

        if (!confirm(confirmationText)) return;

        const button = $("redeemReward");
        setBusy(button, true, "Redeeming...");
        try {
          const data = await apiRequest({
            action: "staff_redeem_member_reward",
            memberId: member.id,
            memberRewardId,
            purchaseAmount: rawPurchaseAmount || null,
            receiptReference: receiptReference || null,
            idempotencyKey: createIdempotencyKey(),
          });

          const operation = data.operation || {};
          renderMember(data);
          $("redeemPurchaseAmount").value = "";
          $("redeemReceipt").value = "";

          const redeemedKind = String(
            readField(operation, "rewardKind", "reward_kind", "kind") || kind,
          );
          const redeemedValue = Number(
            readField(operation, "rewardValue", "reward_value") || 0,
          );
          const duplicateText = operation.idempotent
            ? " This request had already been completed."
            : "";
          const successText =
            fixedAmount !== null || redeemedKind === "percent_discount"
              ? `${title} redeemed successfully. Discount: £${redeemedValue.toFixed(2)}.${duplicateText}`
              : `${title} redeemed successfully.${duplicateText}`;

          message("staffMessage", successText, "ok");
        } catch (error) {
          message(
            "staffMessage",
            error.message || "Reward could not be redeemed.",
            "error",
          );
        } finally {
          setBusy(button, false, "Redeeming...");
          syncRedeemButton();
        }
      });

      $("stopScan").addEventListener("click", stopCamera);

      async function startQrScanner() {
        message("staffMessage", "");

        if (!window.isSecureContext) {
          message(
            "staffMessage",
            "Camera access requires the secure GitHub Pages address beginning with https://. It may not work when staff.html is opened directly from the device files.",
            "error",
          );
          return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
          message(
            "staffMessage",
            "This browser cannot access the camera. Use Chrome or the latest Huawei Browser.",
            "error",
          );
          return;
        }

        if (typeof Html5Qrcode === "undefined") {
          message(
            "staffMessage",
            "The QR scanner library did not load. Check the internet connection and reload the page.",
            "error",
          );
          return;
        }

        await stopCamera();
        $("scanArea").classList.remove("hidden");
        $("scanQr").disabled = true;
        $("scanArea").scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        scanning = true;
        scanHandled = false;

        qrScanner = new Html5Qrcode(
          "qrReader",
          { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] },
          false,
        );

        const onScanSuccess = async (decodedText) => {
          if (!scanning || scanHandled) return;

          const rawValue = String(decodedText || "").trim();
          const parsedQr = parseCustomerQr(rawValue);
          const value = parsedQr.search;
          const isKweiderCode =
            /^KWEIDER-(LOYALTY|REWARDS):/i.test(rawValue) ||
            /^KW-/i.test(value);

          if (!isKweiderCode) {
            message(
              "staffMessage",
              "This is not a Kweider Rewards QR code. Please scan the customer membership card.",
              "error",
            );
            return;
          }

          scanHandled = true;
          pendingQrRewardId = parsedQr.memberRewardId;
          quickSelectedRewardId = parsedQr.memberRewardId;
          quickSelectionFromCustomer = Boolean(
            parsedQr.memberRewardId,
          );
          $("memberSearch").value = value;

          try {
            await stopCamera();
            await findMember(value);
          } catch (error) {
            resetMember();
            message(
              "staffMessage",
              error.message || "The membership QR code could not be opened.",
              "error",
            );
          }
        };

        try {
          await qrScanner.start(
            { facingMode: "environment" },
            {
              fps: 10,
              qrbox: (viewfinderWidth, viewfinderHeight) => {
                const size = Math.floor(
                  Math.min(viewfinderWidth, viewfinderHeight) * 0.72,
                );
                const safeSize = Math.max(180, Math.min(size, 320));
                return { width: safeSize, height: safeSize };
              },
              aspectRatio: 1.333334,
              disableFlip: false,
            },
            onScanSuccess,
            () => {},
          );

          message(
            "staffMessage",
            "Camera ready. Point it at the customer QR code.",
            "info",
          );
        } catch (error) {
          await stopCamera();

          const text = String(error?.message || error || "").toLowerCase();
          let userMessage =
            "Could not open the camera. Allow camera permission, then try again.";

          if (text.includes("notallowed") || text.includes("permission")) {
            userMessage =
              "Camera permission was blocked. Allow camera access for this site in the browser settings, then try again.";
          } else if (
            text.includes("notfound") ||
            text.includes("requested device not found")
          ) {
            userMessage = "No usable rear camera was found on this device.";
          } else if (
            text.includes("notreadable") ||
            text.includes("trackstart")
          ) {
            userMessage =
              "The camera is being used by another app. Close other camera apps and try again.";
          }

          message("staffMessage", userMessage, "error");
        }
      }

      $("scanQr").addEventListener("click", startQrScanner);

      window.addEventListener("pagehide", () => {
        stopCamera();
      });

      document.addEventListener("visibilitychange", () => {
        if (document.hidden && scanning) stopCamera();
      });

      async function start() {
        if (!hasConfiguration()) {
          $("loginCard").classList.add("hidden");
          $("configurationCard").classList.remove("hidden");
          return;
        }

        loadSession();
        if (!session?.access_token) return;

        try {
          const data = await apiRequest({ action: "staff_me" });
          staff = data.staff;
          renderStaff();
        } catch {
          saveSession(null);
        }
      }

      start();
    
