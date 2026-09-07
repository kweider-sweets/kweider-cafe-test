from pathlib import Path

SITE_KEY = "0x4AAAAAAEr2vHuiXic1UKjI"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


rewards_path = Path("rewards.html")
rewards = rewards_path.read_text(encoding="utf-8")

rewards = replace_once(
    rewards,
    '    <script src="assets/vendor/qrcode-local.js"></script>\n',
    '    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" defer></script>\n'
    '    <script src="assets/vendor/qrcode-local.js"></script>\n',
    "Turnstile client script",
)

rewards = replace_once(
    rewards,
    '            <div class="auth-inline-actions">\n'
    '              <button class="primary-btn" type="submit" id="createCardButton">\n'
    '                Create Card & Claim Free Coffee\n',
    f'            <div\n'
    f'              id="turnstileWidget"\n'
    f'              class="cf-turnstile"\n'
    f'              data-sitekey="{SITE_KEY}"\n'
    f'              data-execution="execute"\n'
    f'              data-appearance="interaction-only"\n'
    f'              data-action="create_member"\n'
    f'              data-theme="dark"\n'
    f'              data-size="flexible"\n'
    f'              data-callback="onTurnstileSuccess"\n'
    f'              data-error-callback="onTurnstileError"\n'
    f'              aria-live="polite"\n'
    f'            ></div>\n'
    f'            <div class="auth-inline-actions">\n'
    f'              <button class="primary-btn" type="submit" id="createCardButton">\n'
    f'                Create Card & Claim Free Coffee\n',
    "Turnstile widget",
)

rewards = replace_once(
    rewards,
    '      let notificationPromptShown = false;\n\n'
    '      function openNotificationPrompt() {\n',
    '      let notificationPromptShown = false;\n'
    '      let turnstileResolve = null;\n'
    '      let turnstileReject = null;\n\n'
    '      function clearTurnstilePending() {\n'
    '        turnstileResolve = null;\n'
    '        turnstileReject = null;\n'
    '      }\n\n'
    '      window.onTurnstileSuccess = (token) => {\n'
    '        const resolve = turnstileResolve;\n'
    '        clearTurnstilePending();\n'
    '        if (resolve) resolve(String(token || ""));\n'
    '      };\n\n'
    '      window.onTurnstileError = () => {\n'
    '        const reject = turnstileReject;\n'
    '        clearTurnstilePending();\n'
    '        if (reject) reject(new Error("Security verification failed. Please try again."));\n'
    '      };\n\n'
    '      function resetTurnstile() {\n'
    '        try {\n'
    '          if (window.turnstile?.reset) window.turnstile.reset("#turnstileWidget");\n'
    '        } catch (error) {\n'
    '          console.warn("Unable to reset the security check:", error);\n'
    '        }\n'
    '      }\n\n'
    '      function requestTurnstileToken() {\n'
    '        if (!window.turnstile?.execute) {\n'
    '          return Promise.reject(new Error("The security check is still loading. Please try again."));\n'
    '        }\n'
    '        return new Promise((resolve, reject) => {\n'
    '          turnstileResolve = resolve;\n'
    '          turnstileReject = reject;\n'
    '          try {\n'
    '            window.turnstile.execute("#turnstileWidget");\n'
    '          } catch (error) {\n'
    '            clearTurnstilePending();\n'
    '            reject(new Error("Security verification could not start. Please try again."));\n'
    '          }\n'
    '        });\n'
    '      }\n\n'
    '      function openNotificationPrompt() {\n',
    "Turnstile client helpers",
)

old_submit = '''      $("newMemberForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (requestInProgress) return;

        setLoading(true);
        notice("formMessage", "Creating your rewards card…", "info");
        try {
          const result = await callApi({
            action: "create_member",
            firstName: $("firstName").value.trim(),
            phone: $("createPhone").value.trim(),
            email: null,
            birthday: null,
            notificationConsent: $("notificationConsent").checked,
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
            setTimeout(() => $("resetPhone").focus(), 50);
          } else {
            notice("formMessage", error.message, "error");
          }
        } finally {
          setLoading(false);
        }
      });
'''

new_submit = '''      $("newMemberForm").addEventListener("submit", async (event) => {
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
            setTimeout(() => $("resetPhone").focus(), 50);
          } else {
            notice("formMessage", error.message, "error");
          }
        } finally {
          resetTurnstile();
          setLoading(false);
        }
      });
'''

rewards = replace_once(rewards, old_submit, new_submit, "Registration submit handler")
rewards_path.write_text(rewards, encoding="utf-8")

api_path = Path("edge-functions/kweider-rewards-api/index.ts")
api = api_path.read_text(encoding="utf-8")

api = replace_once(
    api,
    '  notificationConsent?: boolean;\n  token?: string;\n',
    '  notificationConsent?: boolean;\n  turnstileToken?: string;\n  token?: string;\n',
    "Turnstile payload field",
)

verify_helper = '''
interface TurnstileVerificationResult {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
}

const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_REGISTRATION_HOSTNAME = "menu.kweidersweets.co.uk";
const TURNSTILE_REGISTRATION_ACTION = "create_member";

const verifyRegistrationTurnstile = async (
  payload: RequestPayload,
): Promise<void> => {
  const token = cleanText(payload.turnstileToken);
  if (!token || token.length > 2048) {
    throw new ApiError(403, "turnstile_required", "Complete the security check and try again.");
  }

  const secret = cleanText(Deno.env.get("TURNSTILE_SECRET"));
  if (!secret) {
    console.error("TURNSTILE_SECRET is not configured.");
    throw new ApiError(503, "security_check_unavailable", "Security verification is temporarily unavailable. Please try again.");
  }

  let response: Response;
  try {
    response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    });
  } catch (error) {
    console.error("Unable to reach Turnstile Siteverify:", error);
    throw new ApiError(503, "security_check_unavailable", "Security verification is temporarily unavailable. Please try again.");
  }

  if (!response.ok) {
    console.error("Turnstile Siteverify returned HTTP", response.status);
    throw new ApiError(503, "security_check_unavailable", "Security verification is temporarily unavailable. Please try again.");
  }

  let result: TurnstileVerificationResult;
  try {
    result = await response.json();
  } catch (error) {
    console.error("Turnstile Siteverify returned invalid JSON:", error);
    throw new ApiError(503, "security_check_unavailable", "Security verification is temporarily unavailable. Please try again.");
  }

  if (
    result.success !== true ||
    result.hostname !== TURNSTILE_REGISTRATION_HOSTNAME ||
    result.action !== TURNSTILE_REGISTRATION_ACTION
  ) {
    console.warn("Turnstile registration verification rejected", {
      success: result.success === true,
      hostname: result.hostname || "",
      action: result.action || "",
      errorCodes: Array.isArray(result["error-codes"]) ? result["error-codes"] : [],
    });
    throw new ApiError(403, "turnstile_failed", "Security verification failed. Please try again.");
  }
};
'''

api = replace_once(
    api,
    'const cleanOptionalText = (value: unknown): string | null => {\n'
    '  const cleaned = cleanText(value);\n'
    '  return cleaned || null;\n'
    '};\n\n'
    'const isUuid = (value: string): boolean =>\n',
    'const cleanOptionalText = (value: unknown): string | null => {\n'
    '  const cleaned = cleanText(value);\n'
    '  return cleaned || null;\n'
    '};\n' + verify_helper + '\n'
    'const isUuid = (value: string): boolean =>\n',
    "Turnstile server verifier",
)

api = replace_once(
    api,
    '  const settings = await getSettings(admin);\n\n'
    '  const normalisedPhone = await normaliseMemberPhone(admin, phone);\n',
    '  await verifyRegistrationTurnstile(payload);\n\n'
    '  const settings = await getSettings(admin);\n\n'
    '  const normalisedPhone = await normaliseMemberPhone(admin, phone);\n',
    "Turnstile enforcement",
)

api_path.write_text(api, encoding="utf-8")
