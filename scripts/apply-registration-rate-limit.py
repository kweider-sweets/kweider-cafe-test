from pathlib import Path

path = Path("edge-functions/kweider-rewards-api/index.ts")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    text = text.replace(old, new, 1)


anchor = '''const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const normaliseMemberPhone = async (admin: any, phone: string): Promise<string> => {
'''

helper = '''const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const registrationRatePepper = (): string => {
  const pepper = Deno.env.get("KWEIDER_RATE_LIMIT_PEPPER") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!pepper) {
    throw new ApiError(
      503,
      "registration_rate_limit_unavailable",
      "Registration protection is temporarily unavailable. Please try again.",
    );
  }
  return pepper;
};

const registrationClientIp = (req: Request): string => {
  const cloudflareIp = cleanText(req.headers.get("cf-connecting-ip"));
  if (cloudflareIp) return cloudflareIp;

  const forwardedFor = cleanText(req.headers.get("x-forwarded-for"));
  if (forwardedFor) return forwardedFor.split(",")[0].trim();

  return cleanText(req.headers.get("x-real-ip"));
};

const enforceRegistrationRateLimit = async (
  req: Request,
  admin: any,
  normalisedPhone: string,
): Promise<void> => {
  const pepper = registrationRatePepper();
  const phoneHash = await hmacSha256Hex(
    pepper,
    `registration:phone:${normalisedPhone}`,
  );
  const clientIp = registrationClientIp(req);
  const ipHash = clientIp
    ? await hmacSha256Hex(pepper, `registration:ip:${clientIp}`)
    : null;

  const { data, error } = await admin.rpc(
    "kweider_check_registration_rate_limit",
    {
      p_phone_hash: phoneHash,
      p_ip_hash: ipHash,
      p_now: new Date().toISOString(),
    },
  );

  if (error || !data || typeof data !== "object") {
    console.error("Registration rate limit check failed:", error);
    throw new ApiError(
      503,
      "registration_rate_limit_unavailable",
      "Registration protection is temporarily unavailable. Please try again.",
    );
  }

  if (data.allowed !== true) {
    const retryAfterSeconds = Math.max(1, Number(data.retry_after_seconds || 60));
    const retryAfterMinutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    throw new ApiError(
      429,
      "registration_rate_limited",
      `Too many registration attempts. Try again in ${retryAfterMinutes} minute${retryAfterMinutes === 1 ? "" : "s"}.`,
    );
  }
};

const normaliseMemberPhone = async (admin: any, phone: string): Promise<string> => {
'''
replace_once(anchor, helper, "rate limit helper anchor")

replace_once(
    "const createMembership = async (payload: RequestPayload, admin: any) => {",
    "const createMembership = async (payload: RequestPayload, admin: any, req: Request) => {",
    "createMembership signature",
)

existing = '''  if (existingMember) {
    throw new ApiError(
      409,
      "member_exists",
      "A membership already exists for this phone number.",
    );
  }

  const rawToken = createRawToken();
'''
limited = '''  if (existingMember) {
    throw new ApiError(
      409,
      "member_exists",
      "A membership already exists for this phone number.",
    );
  }

  await enforceRegistrationRateLimit(req, admin, String(normalisedPhone));

  const rawToken = createRawToken();
'''
replace_once(existing, limited, "rate limit enforcement position")

replace_once(
    "          return await createMembership(payload, ctx.supabaseAdmin);",
    "          return await createMembership(payload, ctx.supabaseAdmin, req);",
    "create_member dispatch",
)

path.write_text(text, encoding="utf-8")
