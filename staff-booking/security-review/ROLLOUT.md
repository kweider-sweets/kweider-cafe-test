# KWEIDER Booking Manager — five-step hardening rollout / خطة الحماية والتشغيل

## Status · الحالة

Prepared in a **development branch only** on 15 November 2026. No edits were published to GitHub main or Shopify live. Production Supabase `booking-staff-api` is still **v17** after an attempted deployment was blocked by the connected action's safety checks. **Do not treat the server fixes as active.**

تم تجهيز التعديلات في **فرع تطوير فقط**. لم تُنشر على الصفحة الحية. خدمة Supabase ما زالت **v17**؛ محاولة نشر التعديل مُنعت بفحص أمان الأداة. **الحماية الجديدة لم تُفعّل بعد**.

## Five approved workstreams / الخطوات الخمس

1. **Server security / حماية الخادم.** Staged `booking-staff-api-v18.ts`:
   - Denies deletion of capacity overrides referenced by any special event (including post-event cleaning), even if a manager tries to call the endpoint directly.
   - Rejects edits to confirmed web/paid bookings from the generic staff editing route. Financial/refund reconciliation must use a separate authorised workflow.
   - Optional MFA policy: users without an enrolled verified factor retain normal sign-in; once a verified factor is enrolled, the server demands an `aal2` JWT for staff actions.
   - Every denial is server-side and independent of hidden buttons.
2. **MFA & compromised-password prevention / التحقق بخطوتين وكلمات المرور.** UI to enroll an authenticator TOTP factor and verify a six-digit code; login challenges verified factors. Manager and employee must enroll separately using their own authenticator. **Do not enable compulsory MFA without first confirming two-device logins.** Manual Supabase password setting at [Auth settings](https://supabase.com/dashboard/project/zybamugtuzootaovodut/auth/providers?provider=Email) is required for leaked-password checks; current connected actions cannot safely apply this setting. Availability may require the Pro plan or above.
3. **Staff screen lock / قفل شاشة الموظفين.** Local overlay after 15 minutes of inactivity plus a manual Lock button. Unlock requires the existing password (and TOTP if enrolled). The staff session and visible-page alert monitor remain active behind the overlay. **This lock is a privacy/usability control, not an alternative to revoking server tokens or physical device security.**
4. **Better screen layout / ترتيب الشاشة.** Daily summary, bookings and unread notes first; capacity, calendar and events follow. Calendar and events can be expanded/collapsed. Booking details show stored duration for historical bookings. No original panels or controls removed.
5. **Health/status indicators / مؤشرات الاتصال.** Show time of last successful dashboard data refresh and last successful notification check. Preserve five-second polling fallback and the existing Realtime topic/auth implementation.

## Critical release order / ترتيب النشر الإلزامي

- Verify **two accounts** (manager and employee) can sign in and use daily operations.
- Confirm all booking records, event overrides, holds, staff messages, finance and Shopify settings remain unchanged.
- Save the exact production v17 source: `booking-staff-api-v17-original.ts`. Restore this file with `verify_jwt=false` in case of regression.
- First release **security-only** server protections (event override + paid booking guard), without the MFA code if the new frontend has not been released. Run manager authenticated read-only dashboard tests.
- Release UI after real desktop/iPad checks (layout, date selector, unlock with correct/incorrect password, audio, message unread, calendar and events toggles). Keep original realtime code unchanged.
- Only then enable MFA-capable backend **along with** MFA-capable UI. Do **not** enforce `aal2` globally before staff can enroll/challenge. Users with an enrolled factor need the authenticator app on subsequent sign-ins; plan administrator recovery for lost factors.
- Enable leaked-password protection in the dashboard when eligible, then review security advisors.
- Verify during production test: staff note notification, sound, 5-second fallback, booking calendar, private event closure on 28 Nov 2026, 30-minute cleaning, 90+30 booked occupancy, cash/phone booking management, paid online booking read-only, check-in/check-out.

## Evidence from read-only database checks / نتائج التحقق دون تعديل البيانات

- 2 event-owned overrides would be protected by the event-linked guard.
- 1 confirmed, paid WEB booking would be excluded from ordinary edit; existing PHONE bookings remain on their authorised route.
- 0 verified MFA factors at the time of the check (manager and employee must enroll manually).
- 305 availability slots previously tested across 3 dates and 5 party sizes; no mismatches.
- No booking, hold, event, payment, or note rows changed during this preparation.

## Limitations / حدود الاختبار

The new user interface passed **JavaScript syntax** and source-invariant checks only. There has not yet been a browser/iPad full end-to-end test or authenticated API regression test. The server source is staged in GitHub and **has not passed a production deployment**. This work cannot be considered fully released or penetration-tested.

Source of truth: live `main` for web page and active Supabase `booking-staff-api` v17 until release verification.
