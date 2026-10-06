# Member credential boundary fix

Prepared against main `cc6abc1c2990ff9d6698e4061cfb4a55ba73dbe6` and the source referenced by live Edge Function v34 on project `fwjiceleybxhgetsvsvp`.

## Problem and change

Recovery tokens are stored in the member access-token table alongside permanent card tokens. Several member actions previously checked only the hash and revocation marker. A recovery token, including an expired but unrevoked one, could therefore authorize PIN changes through `set_member_pin` instead of the dedicated recovery exchange.

All six permanent-card routes now use one guard: `get_card`, `set_member_pin`, `mark_messages_read`, `update_notification_preference`, `save_push_subscription`, and `remove_push_subscription`. It rejects `rec_` and `pinreset_` credentials before database access, verifies the stored token is not revoked, and checks that the member is active. Database lookup failures deny access. Existing permanent token formats are retained.

There is no migration or bulk data operation. No existing token, PIN, point, reward, transaction, customer, Auth user, or staff role is changed by deploying this code. Normal authorized actions continue to make their existing writes when invoked by customers. The shared member-status check adds one small lookup to these actions. Recovery exchanges, registration, Turnstile, staff role verification, checkout logic, frontend files, service workers, and CNAME are unchanged.

## Verification

Run with Node 24: `node --test tests/member-auth.test.mjs`.

The tests execute the actual handler with mocked Supabase and Deno adapters and no network. They cover temporary tokens, revoked/missing tokens, inactive/missing members, lookup failures, permanent-card access and PIN updates, and denial of unauthenticated staff and ordinary-staff access to manager routes. The fixtures are synthetic. These tests do not validate the Supabase gateway or a real customer recovery end to end.

## Controlled deployment and rollback

Publish only after the owner approves this concrete change. Recheck main and live function before publishing; stop and reconcile any drift. Preserve the existing `verify_jwt=false` setting because public customer actions use custom authentication. Deploy the approved immutable source with its existing dependencies; do not change environment secrets.

After deployment, use health, staff-without-session, disallowed-origin checks, and synthetic temporary credentials rejected before database access. Do not exercise successful member actions or recovery against a real customer without permission. Keep the approved source and deployed function version recorded together.

If a regression appears, restore the exact preceding function source/configuration (v34 source references commit `91c3e0428aed1b9a24b715c48a0d33c554888b3b`). Supabase assigns a new deployment version when restoring old source. No database rollback is required. Restoring old source also restores its known credential-boundary weakness; use rollback only to recover service while preparing a corrected fix.

## Remaining work; not fixed by this patch

- Bind staff reset approval to a request verified with the customer, and rate-limit reset creation without allowing an attacker to replace the approved request.
- Make recovery consumption/token exchange atomic and make PIN-attempt counting atomic. These require a separately reviewed database plan and approval before SQL changes.
- Review and remove unnecessary Welcome Coffee grants only with explicit approval, including a recorded grant rollback.
- Password protection, MFA design, noindex, performance findings, and full device/PWA verification remain separate audit items.

Do not declare the security audit closed based on this patch alone.
