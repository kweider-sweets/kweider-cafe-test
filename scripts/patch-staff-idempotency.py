from pathlib import Path
import re

# One-time runner trigger; this file is removed by the workflow after success.
files = [Path('staff.html'), Path('staff-app/index.html')]

old_key_fn = '''      function createIdempotencyKey() {
        if (globalThis.crypto?.randomUUID)
          return globalThis.crypto.randomUUID();
        return `web-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      }
'''

new_key_fn = '''      function createIdempotencyKey() {
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
'''

for path in files:
    text = path.read_text(encoding='utf-8')

    if len(re.findall(r'value="qw\.co\.uk@gmail\.com"', text)) != 1:
        raise SystemExit(f'{path}: default email marker mismatch')
    text = re.sub(r'\s*value="qw\.co\.uk@gmail\.com"', '', text, count=1)

    if text.count(old_key_fn) != 1:
        raise SystemExit(f'{path}: key function mismatch')
    text = text.replace(old_key_fn, new_key_fn, 1)

    state = '      let quickSelectionFromCustomer = false;\n'
    if text.count(state) != 1:
        raise SystemExit(f'{path}: checkout state marker mismatch')
    text = text.replace(state, state + '      let pendingCheckoutRequest = null;\n', 1)

    reset = '      function resetMember() {\n'
    if text.count(reset) != 1:
        raise SystemExit(f'{path}: reset marker mismatch')
    text = text.replace(reset, reset + '        pendingCheckoutRequest = null;\n', 1)

    handler = text.find('      $("completeCheckout").addEventListener(')
    request = text.find('action: "staff_complete_checkout"', handler)
    catch = text.find('          } catch (error) {', request)
    old_call = 'idempotencyKey: createIdempotencyKey(),'
    call = text.find(old_call, request)
    if min(handler, request, catch, call) < 0 or call > catch:
        raise SystemExit(f'{path}: checkout request markers mismatch')
    text = text[:call] + 'idempotencyKey: checkoutRequestKey(plan),' + text[call + len(old_call):]

    catch = text.find('          } catch (error) {', request)
    text = text[:catch] + '            pendingCheckoutRequest = null;\n' + text[catch:]

    if 'Math.random()' in text:
        raise SystemExit(f'{path}: Math.random remains')
    if 'qw.co.uk@gmail.com' in text:
        raise SystemExit(f'{path}: default email remains')
    if text.count('idempotencyKey: checkoutRequestKey(plan),') != 1:
        raise SystemExit(f'{path}: retry-stable checkout key mismatch')

    path.write_text(text, encoding='utf-8')
