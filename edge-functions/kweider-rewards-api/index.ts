import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import webpush from "npm:web-push@3.6.7";

interface RequestPayload {
  action?: string;

  // Customer membership
  firstName?: string;
  phone?: string;
  email?: string | null;
  birthday?: string | null;
  marketingConsent?: boolean;
  notificationConsent?: boolean;
  token?: string;

  // App notification subscription for the current device
  pushEndpoint?: string;
  pushP256dh?: string;
  pushAuth?: string;
  deviceLabel?: string;
  userAgent?: string;
  recoveryToken?: string;
  resetToken?: string;
  pin?: string;

  // Staff operations
  memberSearch?: string;
  memberId?: string;
  purchaseAmount?: number;
  receiptReference?: string;
  numberOfRewards?: number;
  memberRewardId?: string;
  breakfastConfirmed?: boolean;
  welcomeCoffeeConfirmed?: boolean;
  idempotencyKey?: string;

  // Manager-only broadcast
  broadcastTitle?: string;
  broadcastBody?: string;
  broadcastStartAt?: string | null;
  broadcastEndAt?: string | null;
  broadcastSendPush?: boolean;
}

class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200): Response =>
  Response.json(body, { status, headers: corsHeaders });

const cleanText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const cleanOptionalText = (value: unknown): string | null => {
  const cleaned = cleanText(value);
  return cleaned || null;
};

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const createRawToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const RECOVERY_TOKEN_TTL_MS = 15 * 60 * 1000;

const createRecoveryToken = () => {
  const expiresAtMs = Date.now() + RECOVERY_TOKEN_TTL_MS;

  return {
    rawToken: `rec_${expiresAtMs.toString(36)}_${createRawToken()}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
};

const recoveryExpiryMs = (token: string): number | null => {
  const match = token.match(/^rec_([0-9a-z]+)_[A-Za-z0-9_-]{30,}$/);
  if (!match) return null;

  const value = Number.parseInt(match[1], 36);
  return Number.isFinite(value) ? value : null;
};

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;
const PIN_RESET_TTL_MS = 10 * 60 * 1000;

const createPinResetToken = () => {
  const expiresAtMs = Date.now() + PIN_RESET_TTL_MS;
  return {
    rawToken: `pinreset_${expiresAtMs.toString(36)}_${createRawToken()}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
};

const pinResetExpiryMs = (token: string): number | null => {
  const match = token.match(/^pinreset_([0-9a-z]+)_[A-Za-z0-9_-]{30,}$/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 36);
  return Number.isFinite(value) ? value : null;
};

const validatePin = (value: unknown): string => {
  const pin = cleanText(value);
  if (!/^\d{4}$/.test(pin)) {
    throw new ApiError(400, "invalid_pin", "Enter a 4-digit PIN.");
  }
  return pin;
};

const createPinSalt = (): string => createRawToken().slice(0, 24);

const pinPepper = (): string => {
  const pepper =
    Deno.env.get("KWEIDER_PIN_PEPPER") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    "";

  if (!pepper) {
    throw new ApiError(
      500,
      "pin_service_unavailable",
      "Secure PIN access is temporarily unavailable.",
    );
  }

  return pepper;
};

const hmacSha256Hex = async (keyValue: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyValue),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const hashPin = async (pin: string, salt: string): Promise<string> =>
  hmacSha256Hex(pinPepper(), `${salt}:${pin}`);

const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const normaliseMemberPhone = async (admin: any, phone: string): Promise<string> => {
  const { data, error } = await admin.rpc("kweider_normalize_phone", {
    p_phone: phone,
  });
  if (error || !data) {
    throw new ApiError(
      400,
      "invalid_phone",
      "Use a valid UK number beginning 07 or +44.",
    );
  }
  return String(data);
};

const issueMemberCardToken = async (admin: any, memberId: string): Promise<string> => {
  const rawToken = createRawToken();
  const tokenHash = await sha256Hex(rawToken);
  const { error } = await admin
    .from("kweider_member_access_tokens")
    .insert({ member_id: memberId, token_hash: tokenHash });
  if (error) {
    console.error("Unable to issue member card token:", error);
    throw new ApiError(
      500,
      "token_creation_failed",
      "The membership card could not be secured.",
    );
  }
  return rawToken;
};

const requireMemberAccess = async (admin: any, tokenValue: unknown) => {
  const token = cleanText(tokenValue);
  if (token.length < 30) {
    throw new ApiError(401, "invalid_card_token", "The saved membership card is not valid.");
  }

  const tokenHash = await sha256Hex(token);
  const { data: accessToken, error } = await admin
    .from("kweider_member_access_tokens")
    .select("id, member_id, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !accessToken || accessToken.revoked_at) {
    throw new ApiError(401, "invalid_card_token", "The saved membership card is no longer valid.");
  }

  return { token, accessToken, memberId: String(accessToken.member_id) };
};

const memberSelect = `
  id,
  member_code,
  first_name,
  phone_e164,
  email,
  birthday,
  marketing_consent,
  notification_consent,
  notification_consent_at,
  notification_consent_revoked_at,
  notification_preference_updated_at,
  reward_cycle,
  last_visit_at,
  points_balance,
  status,
  access_pin_hash,
  access_pin_salt,
  access_pin_failed_attempts,
  access_pin_locked_until,
  access_pin_updated_at,
  created_at
`;

const transactionSelect = `
  transaction_type,
  points_delta,
  purchase_amount,
  reward_value,
  receipt_reference,
  performed_by_name,
  notes,
  created_at
`;

const getSettings = async (admin: any) => {
  const { data, error } = await admin
    .from("kweider_loyalty_settings")
    .select("points_per_pound, points_per_reward, reward_value")
    .eq("id", 1)
    .single();

  if (error || !data) {
    console.error("Unable to read loyalty settings:", error);
    throw new ApiError(
      500,
      "settings_unavailable",
      "The loyalty settings are temporarily unavailable.",
    );
  }

  return {
    pointsPerPound: Number(data.points_per_pound),
    pointsPerReward: Number(data.points_per_reward),
    rewardValue: Number(data.reward_value),
  };
};

const formatMember = (member, settings, rewards = [], rewardDefinitions = [])=>{
  const points = Number(member.points_balance ?? 0);
  const nowMs = Date.now();
  const availableRewardRows = (rewards ?? []).filter((reward)=>{
    if (reward?.status !== "available") return false;
    if (!reward.expires_at) return true;
    const expiresAtMs = new Date(reward.expires_at).getTime();
    return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
  });
  const definitionsByCode = new Map((rewardDefinitions ?? []).map((definition)=>[
      definition.code,
      definition
    ]));
  const availableRewards = availableRewardRows.length;
  const availableRewardValue = availableRewardRows.reduce((total, reward)=>{
    const maximumDiscount = definitionsByCode.get(reward.reward_code)?.maximum_discount;
    const numericValue = maximumDiscount === null || maximumDiscount === undefined ? 0 : Number(maximumDiscount);
    return total + (Number.isFinite(numericValue) ? numericValue : 0);
  }, 0);
  return {
    id: member.id,
    memberCode: member.member_code,
    firstName: member.first_name,
    phone: member.phone_e164,
    email: member.email,
    birthday: member.birthday,
    marketingConsent: member.marketing_consent,
    notificationConsent: member.notification_consent === true,
    notificationConsentAt: member.notification_consent_at,
    notificationConsentRevokedAt: member.notification_consent_revoked_at,
    notificationPreferenceUpdatedAt: member.notification_preference_updated_at,
    rewardCycle: Number(member.reward_cycle ?? 1),
    lastVisitAt: member.last_visit_at,
    points,
    status: member.status,
    createdAt: member.created_at,
    pinConfigured: Boolean(member.access_pin_hash && member.access_pin_salt),
    availableRewards,
    availableRewardValue
  };
};
const formatTransactions = (transactions: any[]) =>
  (transactions ?? []).map((transaction: any) => ({
    type: transaction.transaction_type,
    pointsDelta: Number(transaction.points_delta),
    purchaseAmount:
      transaction.purchase_amount === null
        ? null
        : Number(transaction.purchase_amount),
    rewardValue:
      transaction.reward_value === null
        ? null
        : Number(transaction.reward_value),
    receiptReference: transaction.receipt_reference,
    performedByName: transaction.performed_by_name,
    notes: transaction.notes,
    createdAt: transaction.created_at,
  }));

const formatWelcomeCoffee = (coffee: any) => {
  if (!coffee) return null;

  const expiresAt = coffee.expires_at || null;
  const expired =
    coffee.status === "available" &&
    expiresAt &&
    new Date(expiresAt).getTime() <= Date.now();

  return {
    id: coffee.id,
    status: expired ? "expired" : coffee.status,
    issuedAt: coffee.issued_at,
    expiresAt,
    redeemedAt: coffee.redeemed_at,
    redeemedByName: coffee.redeemed_by_name,
    purchaseAmount:
      coffee.purchase_amount === null || coffee.purchase_amount === undefined
        ? null
        : Number(coffee.purchase_amount),
    receiptReference: coffee.receipt_reference,
  };
};

const loadMemberBundle = async (admin: any, memberId: string) => {
  const { data: member, error: memberError } = await admin
    .from("kweider_members")
    .select(memberSelect)
    .eq("id", memberId)
    .single();

  if (memberError || !member) {
    throw new ApiError(404, "member_not_found", "The membership could not be found.");
  }

  const { data: transactions, error: transactionError } = await admin
    .from("kweider_loyalty_transactions")
    .select(transactionSelect)
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (transactionError) {
    console.error("Unable to read transactions:", transactionError);
    throw new ApiError(
      500,
      "transaction_history_failed",
      "The membership history could not be loaded.",
    );
  }

  const settings = await getSettings(admin);
const nowIso = new Date().toISOString();

const {
  data: rewardDefinitions,
  error: rewardDefinitionsError,
} = await admin
  .from("kweider_reward_definitions")
  .select(
    "code, threshold_points, reward_kind, title_en, title_ar, message_en, message_ar, percent_off, maximum_discount, validity_days, sort_order",
  )
  .eq("active", true)
  .order("threshold_points", { ascending: true });

if (rewardDefinitionsError) {
  console.error(
    "Unable to read reward definitions:",
    rewardDefinitionsError,
  );

  throw new ApiError(
    500,
    "reward_definitions_failed",
    "The rewards programme could not be loaded.",
  );
}

const { data: rewards, error: rewardsError } = await admin
  .from("kweider_member_rewards")
  .select(
    "id, reward_code, cycle_number, status, issued_at, expires_at, redeemed_at",
  )
  .eq("member_id", memberId)
  .order("issued_at", { ascending: false })
  .limit(20);

if (rewardsError) {
  console.error("Unable to read member rewards:", rewardsError);

  throw new ApiError(
    500,
    "member_rewards_failed",
    "The member rewards could not be loaded.",
  );
}

const { data: messages, error: messagesError } = await admin
  .from("kweider_member_messages")
  .select(
    "id, message_type, title_en, title_ar, body_en, body_ar, is_read, read_at, related_reward_id, created_at, expires_at",
  )
  .eq("member_id", memberId)
  .lte("not_before", nowIso)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
  .order("created_at", { ascending: false })
  .limit(30);

if (messagesError) {
  console.error("Unable to read member messages:", messagesError);

  throw new ApiError(
    500,
    "member_messages_failed",
    "The member messages could not be loaded.",
  );
}

const { data: welcomeCoffee, error: welcomeCoffeeError } = await admin
  .from("kweider_welcome_coffees")
  .select(
    "id, status, issued_at, expires_at, redeemed_at, redeemed_by_name, purchase_amount, receipt_reference",
  )
  .eq("member_id", memberId)
  .maybeSingle();

if (welcomeCoffeeError) {
  console.error("Unable to read welcome coffee:", welcomeCoffeeError);
  throw new ApiError(
    500,
    "welcome_coffee_failed",
    "The welcome coffee could not be loaded.",
  );
}

const formattedMessages = (messages ?? []).map((message: any) => ({
  id: message.id,
  type: message.message_type,
  titleEn: message.title_en,
  titleAr: message.title_ar,
  bodyEn: message.body_en,
  bodyAr: message.body_ar,
  isRead: message.is_read,
  readAt: message.read_at,
  relatedRewardId: message.related_reward_id,
  createdAt: message.created_at,
  expiresAt: message.expires_at,
}));

return {
  member: formatMember(member, settings, rewards ?? [], rewardDefinitions ?? []),
  transactions: formatTransactions(transactions ?? []),
  settings,

  rewardDefinitions: (rewardDefinitions ?? []).map(
    (definition: any) => ({
      code: definition.code,
      thresholdPoints: Number(definition.threshold_points),
      kind: definition.reward_kind,
      titleEn: definition.title_en,
      titleAr: definition.title_ar,
      messageEn: definition.message_en,
      messageAr: definition.message_ar,
      percentOff:
        definition.percent_off === null
          ? null
          : Number(definition.percent_off),
      maximumDiscount:
        definition.maximum_discount === null
          ? null
          : Number(definition.maximum_discount),
      validityDays: Number(definition.validity_days),
      sortOrder: Number(definition.sort_order),
    }),
  ),

  rewards: (rewards ?? []).map((reward: any) => ({
    id: reward.id,
    code: reward.reward_code,
    cycleNumber: Number(reward.cycle_number),
    status: reward.status,
    issuedAt: reward.issued_at,
    expiresAt: reward.expires_at,
    redeemedAt: reward.redeemed_at,
  })),

  messages: formattedMessages,

  welcomeCoffee: formatWelcomeCoffee(welcomeCoffee),

  unreadMessageCount: formattedMessages.filter(
    (message: any) => !message.isRead,
  ).length,
};
};


const formatPinResetRequest = (request: any) =>
  request
    ? {
        id: request.id,
        status: request.status,
        requestedAt: request.requested_at,
        expiresAt: request.expires_at,
        approvedAt: request.approved_at,
      }
    : null;

const latestActivePinReset = async (admin: any, memberId: string) => {
  const { data, error } = await admin
    .from("kweider_pin_reset_requests")
    .select("id, status, requested_at, expires_at, approved_at")
    .eq("member_id", memberId)
    .in("status", ["pending", "approved"])
    .gt("expires_at", new Date().toISOString())
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Unable to read card restore request:", error);
    throw new ApiError(
      500,
      "pin_reset_check_failed",
      "The card restore request could not be checked.",
    );
  }

  return data || null;
};

const requestPinReset = async (payload: RequestPayload, admin: any) => {
  const phone = cleanText(payload.phone);
  if (!phone) {
    throw new ApiError(400, "invalid_phone", "Enter your mobile number.");
  }

  const normalisedPhone = await normaliseMemberPhone(admin, phone);
  const { data: member, error: memberError } = await admin
    .from("kweider_members")
    .select("id, member_code, first_name, status, access_pin_hash, access_pin_salt")
    .eq("phone_e164", String(normalisedPhone))
    .maybeSingle();

  if (memberError) {
    console.error("Unable to find member for card restore:", memberError);
    throw new ApiError(
      500,
      "pin_reset_request_failed",
      "The card restore request could not be started.",
    );
  }

  if (!member) {
    throw new ApiError(404, "member_not_found", "No Kweider card was found for this mobile number.");
  }

  if (member.status !== "active") {
    throw new ApiError(403, "membership_unavailable", "This membership is not currently active.");
  }


  await admin
    .from("kweider_pin_reset_requests")
    .update({ status: "cancelled" })
    .eq("member_id", member.id)
    .in("status", ["pending", "approved"]);

  const { rawToken, expiresAt } = createPinResetToken();
  const tokenHash = await sha256Hex(rawToken);
  const { data: request, error: requestError } = await admin
    .from("kweider_pin_reset_requests")
    .insert({
      member_id: member.id,
      token_hash: tokenHash,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id, status, requested_at, expires_at, approved_at")
    .single();

  if (requestError || !request) {
    console.error("Unable to create card restore request:", requestError);
    throw new ApiError(
      500,
      "pin_reset_request_failed",
      "The card restore request could not be started.",
    );
  }

  return json({
    ok: true,
    action: "request_pin_reset",
    resetToken: rawToken,
    pinResetRequest: formatPinResetRequest(request),
  });
};

const checkPinReset = async (payload: RequestPayload, admin: any) => {
  const resetToken = cleanText(payload.resetToken);
  const expiresAtMs = pinResetExpiryMs(resetToken);
  if (!expiresAtMs || resetToken.length < 45) {
    throw new ApiError(401, "invalid_pin_reset", "This card restore request is not valid.");
  }

  const tokenHash = await sha256Hex(resetToken);
  const { data: request, error } = await admin
    .from("kweider_pin_reset_requests")
    .select("id, member_id, status, requested_at, expires_at, approved_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !request) {
    throw new ApiError(404, "pin_reset_not_found", "This card restore request could not be found.");
  }

  const expired = Date.now() >= new Date(request.expires_at).getTime();
  if (expired && ["pending", "approved"].includes(request.status)) {
    await admin
      .from("kweider_pin_reset_requests")
      .update({ status: "expired" })
      .eq("id", request.id);
    request.status = "expired";
  }

  return json({
    ok: true,
    action: "check_pin_reset",
    pinResetRequest: formatPinResetRequest(request),
  });
};

const completePinReset = async (payload: RequestPayload, admin: any) => {
  const resetToken = cleanText(payload.resetToken);
  const suppliedPin = cleanText(payload.pin);
  const pin = suppliedPin
    ? validatePin(suppliedPin)
    : String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, "0");
  const expiresAtMs = pinResetExpiryMs(resetToken);

  if (!expiresAtMs || resetToken.length < 45) {
    throw new ApiError(401, "invalid_pin_reset", "This card restore request is not valid.");
  }

  const tokenHash = await sha256Hex(resetToken);
  const { data: request, error: requestError } = await admin
    .from("kweider_pin_reset_requests")
    .select("id, member_id, status, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (requestError || !request) {
    throw new ApiError(404, "pin_reset_not_found", "This card restore request could not be found.");
  }

  if (request.used_at || request.status === "used") {
    throw new ApiError(409, "pin_reset_used", "This card restore request has already been used.");
  }

  if (Date.now() >= new Date(request.expires_at).getTime()) {
    throw new ApiError(410, "pin_reset_expired", "This card restore request has expired. Start again.");
  }

  if (request.status !== "approved") {
    throw new ApiError(409, "pin_reset_not_approved", "A member of staff must approve this card restore first.");
  }

  const pinSalt = createPinSalt();
  const pinHash = await hashPin(pin, pinSalt);
  const permanentToken = createRawToken();
  const permanentHash = await sha256Hex(permanentToken);

  const { error: completeError } = await admin.rpc("kweider_complete_pin_reset", {
    p_reset_id: request.id,
    p_member_id: request.member_id,
    p_pin_hash: pinHash,
    p_pin_salt: pinSalt,
    p_new_token_hash: permanentHash,
  });

  if (completeError) {
    const raw = [completeError.message, completeError.details, completeError.hint]
      .filter(Boolean)
      .join(" ");
    if (raw.includes("PIN_RESET_NOT_APPROVED")) {
      throw new ApiError(409, "pin_reset_not_approved", "A member of staff must approve this card restore first.");
    }
    if (raw.includes("MEMBER_NOT_FOUND")) {
      throw new ApiError(404, "member_not_found", "The membership could not be found.");
    }
    console.error("Unable to complete card restore:", completeError);
    throw new ApiError(500, "pin_reset_failed", "The card could not be restored.");
  }

  const bundle = await loadMemberBundle(admin, request.member_id);
  return json({
    ok: true,
    action: "complete_pin_reset",
    token: permanentToken,
    ...bundle,
  });
};

const createMembership = async (payload: RequestPayload, admin: any) => {
  const firstName = cleanText(payload.firstName);
  const phone = cleanText(payload.phone);
  const email = cleanOptionalText(payload.email);
  const birthday = cleanOptionalText(payload.birthday);
  // marketingConsent is accepted temporarily for backward compatibility
  // while the customer page is upgraded to notificationConsent.
  const notificationConsent =
    payload.notificationConsent === true || payload.marketingConsent === true;
  const optionalPin = cleanText(payload.pin);
  const pin = optionalPin ? validatePin(optionalPin) : "";

  if (!firstName || firstName.length > 50) {
    throw new ApiError(400, "invalid_first_name", "Enter a valid first name.");
  }

  if (!phone) {
    throw new ApiError(400, "invalid_phone", "Enter a valid phone number.");
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, "invalid_email", "Enter a valid email address.");
  }

  if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    throw new ApiError(
      400,
      "invalid_birthday",
      "Enter the birthday in YYYY-MM-DD format.",
    );
  }

  const settings = await getSettings(admin);

  const normalisedPhone = await normaliseMemberPhone(admin, phone);
  const pinSalt = pin ? createPinSalt() : null;
  const pinHash = pin && pinSalt ? await hashPin(pin, pinSalt) : null;

  const { data: existingMember, error: existingError } = await admin
    .from("kweider_members")
    .select("id")
    .eq("phone_e164", String(normalisedPhone))
    .maybeSingle();

  if (existingError) {
    console.error("Unable to check existing member:", existingError);
    throw new ApiError(
      500,
      "membership_check_failed",
      "The membership could not be checked.",
    );
  }

  if (existingMember) {
    throw new ApiError(
      409,
      "member_exists",
      "A membership already exists for this phone number.",
    );
  }

  const rawToken = createRawToken();
  const tokenHash = await sha256Hex(rawToken);
  let memberId: string | null = null;

  try {
    const { data: member, error: memberError } = await admin
      .from("kweider_members")
      .insert({
        first_name: firstName,
        phone_e164: String(normalisedPhone),
        email,
        birthday,
        marketing_consent: false,
        notification_consent: notificationConsent,
        notification_consent_at: notificationConsent
          ? new Date().toISOString()
          : null,
        notification_consent_revoked_at: null,
        notification_preference_updated_at: new Date().toISOString(),
        access_pin_hash: pinHash,
        access_pin_salt: pinSalt,
        access_pin_failed_attempts: 0,
        access_pin_locked_until: null,
        access_pin_updated_at: pin ? new Date().toISOString() : null,
      })
      .select(memberSelect)
      .single();

    if (memberError || !member) {
      if (memberError?.code === "23505") {
        throw new ApiError(
          409,
          "member_exists",
          "A membership already exists for this phone number.",
        );
      }

      console.error("Unable to create membership:", memberError);
      throw new ApiError(
        500,
        "membership_creation_failed",
        "The membership could not be created.",
      );
    }

    memberId = member.id;

    const { error: tokenError } = await admin
      .from("kweider_member_access_tokens")
      .insert({ member_id: member.id, token_hash: tokenHash });

    if (tokenError) {
      console.error("Unable to create membership token:", tokenError);
      throw new ApiError(
        500,
        "token_creation_failed",
        "The membership card could not be secured.",
      );
    }

    const welcomeCoffeeExpiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data: welcomeCoffee, error: welcomeCoffeeError } = await admin
      .from("kweider_welcome_coffees")
      .insert({
        member_id: member.id,
        status: "available",
        expires_at: welcomeCoffeeExpiresAt,
      })
      .select(
        "id, status, issued_at, expires_at, redeemed_at, redeemed_by_name, purchase_amount, receipt_reference",
      )
      .single();

    if (welcomeCoffeeError || !welcomeCoffee) {
      console.error("Unable to create welcome coffee:", welcomeCoffeeError);
      throw new ApiError(
        500,
        "welcome_coffee_creation_failed",
        "The welcome coffee could not be prepared.",
      );
    }

    const { data: welcome, error: welcomeError } = await admin
      .from("kweider_loyalty_transactions")
      .insert({
        member_id: member.id,
        transaction_type: "welcome",
        points_delta: 0,
        notes: "Welcome to Kweider Rewards",
      })
      .select(transactionSelect)
      .single();

    if (welcomeError || !welcome) {
      console.error("Unable to create welcome transaction:", welcomeError);
      throw new ApiError(
        500,
        "welcome_transaction_failed",
        "The membership history could not be created.",
      );
    }

    return json(
      {
        ok: true,
        action: "create_member",
        token: rawToken,
        member: formatMember(member, settings),
        transactions: formatTransactions([welcome]),
        welcomeCoffee: formatWelcomeCoffee(welcomeCoffee),
        settings,
      },
      201,
    );
  } catch (error) {
    if (memberId) {
      await admin.from("kweider_members").delete().eq("id", memberId);
    }
    throw error;
  }
};

const loginWithPin = async (payload: RequestPayload, admin: any) => {
  const phone = cleanText(payload.phone);
  const pin = validatePin(payload.pin);
  if (!phone) {
    throw new ApiError(400, "invalid_phone", "Enter your mobile number.");
  }

  const normalisedPhone = await normaliseMemberPhone(admin, phone);
  const { data: member, error } = await admin
    .from("kweider_members")
    .select(memberSelect)
    .eq("phone_e164", normalisedPhone)
    .maybeSingle();

  if (error) {
    console.error("Unable to open membership by PIN:", error);
    throw new ApiError(500, "membership_check_failed", "The membership could not be checked.");
  }

  if (!member) {
    await hashPin(pin, "missing-member");
    throw new ApiError(401, "invalid_phone_or_pin", "The mobile number or PIN is incorrect.");
  }

  if (member.status !== "active") {
    throw new ApiError(403, "membership_unavailable", "This membership is not currently active.");
  }

  if (!member.access_pin_hash || !member.access_pin_salt) {
    throw new ApiError(409, "pin_not_set", "This existing card does not have an access PIN yet. Open it on the device where it is already visible and create a PIN once.");
  }

  const lockedUntilMs = member.access_pin_locked_until
    ? new Date(member.access_pin_locked_until).getTime()
    : 0;
  if (Number.isFinite(lockedUntilMs) && lockedUntilMs > Date.now()) {
    const minutes = Math.max(1, Math.ceil((lockedUntilMs - Date.now()) / 60000));
    throw new ApiError(429, "pin_locked", `Too many incorrect attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }

  const candidateHash = await hashPin(pin, member.access_pin_salt);
  if (!constantTimeEqual(candidateHash, member.access_pin_hash)) {
    const failedAttempts = Number(member.access_pin_failed_attempts || 0) + 1;
    const shouldLock = failedAttempts >= PIN_MAX_ATTEMPTS;
    const lockedUntil = shouldLock
      ? new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000).toISOString()
      : null;

    await admin
      .from("kweider_members")
      .update({
        access_pin_failed_attempts: shouldLock ? PIN_MAX_ATTEMPTS : failedAttempts,
        access_pin_locked_until: lockedUntil,
      })
      .eq("id", member.id);

    if (shouldLock) {
      throw new ApiError(429, "pin_locked", `Too many incorrect attempts. Try again in ${PIN_LOCK_MINUTES} minutes.`);
    }

    throw new ApiError(401, "invalid_phone_or_pin", "The mobile number or PIN is incorrect.");
  }

  await admin
    .from("kweider_members")
    .update({ access_pin_failed_attempts: 0, access_pin_locked_until: null })
    .eq("id", member.id);

  const token = await issueMemberCardToken(admin, member.id);
  const bundle = await loadMemberBundle(admin, member.id);
  return json({ ok: true, action: "login_with_pin", token, ...bundle });
};

const setMemberPin = async (payload: RequestPayload, admin: any) => {
  const token = cleanText(payload.token);
  const pin = validatePin(payload.pin);
  if (token.length < 30) {
    throw new ApiError(401, "invalid_card_token", "The saved membership card is not valid.");
  }

  const tokenHash = await sha256Hex(token);
  const { data: accessToken, error: accessError } = await admin
    .from("kweider_member_access_tokens")
    .select("id, member_id, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (accessError || !accessToken || accessToken.revoked_at) {
    throw new ApiError(401, "invalid_card_token", "The saved membership card is no longer valid.");
  }

  const pinSalt = createPinSalt();
  const pinHash = await hashPin(pin, pinSalt);
  const { error: updateError } = await admin
    .from("kweider_members")
    .update({
      access_pin_hash: pinHash,
      access_pin_salt: pinSalt,
      access_pin_failed_attempts: 0,
      access_pin_locked_until: null,
      access_pin_updated_at: new Date().toISOString(),
    })
    .eq("id", accessToken.member_id);

  if (updateError) {
    console.error("Unable to save member PIN:", updateError);
    throw new ApiError(500, "pin_save_failed", "The access PIN could not be saved.");
  }

  const bundle = await loadMemberBundle(admin, accessToken.member_id);
  return json({ ok: true, action: "set_member_pin", ...bundle });
};

const openSavedCard = async (payload: RequestPayload, admin: any) => {
  const token = cleanText(payload.token);

  if (token.startsWith("rec_")) {
    throw new ApiError(
      401,
      "recovery_token_required",
      "Open the complete recovery link supplied by a member of staff.",
    );
  }

  if (token.length < 30) {
    throw new ApiError(
      401,
      "invalid_card_token",
      "The saved membership card is not valid.",
    );
  }

  const tokenHash = await sha256Hex(token);

  const { data: accessToken, error: accessError } = await admin
    .from("kweider_member_access_tokens")
    .select("id, member_id, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (accessError || !accessToken || accessToken.revoked_at) {
    throw new ApiError(
      401,
      "invalid_card_token",
      "The saved membership card is no longer valid.",
    );
  }

  const bundle = await loadMemberBundle(admin, accessToken.member_id);

  if (bundle.member.status !== "active") {
    throw new ApiError(
      403,
      "membership_unavailable",
      "This membership is not currently active.",
    );
  }

  await admin
    .from("kweider_member_access_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", accessToken.id);

  return json({ ok: true, action: "get_card", ...bundle });
};
const recoverMemberCard = async (
  payload: RequestPayload,
  admin: any,
) => {
  const recoveryToken = cleanText(payload.recoveryToken);
  const expiresAtMs = recoveryExpiryMs(recoveryToken);

  if (!expiresAtMs || recoveryToken.length < 40) {
    throw new ApiError(
      401,
      "invalid_recovery_link",
      "This card recovery link is not valid.",
    );
  }

  const recoveryHash = await sha256Hex(recoveryToken);

  const { data: recoveryAccess, error: recoveryError } = await admin
    .from("kweider_member_access_tokens")
    .select("id, member_id, revoked_at")
    .eq("token_hash", recoveryHash)
    .maybeSingle();

  if (recoveryError || !recoveryAccess || recoveryAccess.revoked_at) {
    throw new ApiError(
      401,
      "recovery_link_used",
      "This card recovery link has already been used or cancelled.",
    );
  }

  if (Date.now() > expiresAtMs) {
    await admin
      .from("kweider_member_access_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", recoveryAccess.id);

    throw new ApiError(
      410,
      "recovery_link_expired",
      "This card recovery link has expired. Ask a member of staff for a new link.",
    );
  }

  const bundle = await loadMemberBundle(admin, recoveryAccess.member_id);

  if (bundle.member.status !== "active") {
    throw new ApiError(
      403,
      "membership_unavailable",
      "This membership is not currently active.",
    );
  }

  const permanentToken = createRawToken();
  const permanentHash = await sha256Hex(permanentToken);

  const { data: permanentAccess, error: permanentError } = await admin
    .from("kweider_member_access_tokens")
    .insert({
      member_id: recoveryAccess.member_id,
      token_hash: permanentHash,
    })
    .select("id")
    .single();

  if (permanentError || !permanentAccess) {
    console.error("Unable to create restored card token:", permanentError);
    throw new ApiError(
      500,
      "card_restore_failed",
      "The membership card could not be restored.",
    );
  }

  const nowIso = new Date().toISOString();
  const { error: revokeError } = await admin
    .from("kweider_member_access_tokens")
    .update({ revoked_at: nowIso })
    .eq("member_id", recoveryAccess.member_id)
    .neq("id", permanentAccess.id)
    .is("revoked_at", null);

  if (revokeError) {
    console.error("Unable to revoke previous card tokens:", revokeError);
    await admin
      .from("kweider_member_access_tokens")
      .delete()
      .eq("id", permanentAccess.id);

    throw new ApiError(
      500,
      "card_restore_failed",
      "The membership card could not be restored safely.",
    );
  }

  return json({
    ok: true,
    action: "recover_card",
    token: permanentToken,
    ...bundle,
  });
};


let vapidConfigured = false;

const configureWebPush = () => {
  const subject = cleanText(Deno.env.get("KWEIDER_VAPID_SUBJECT"));
  const publicKey = cleanText(Deno.env.get("KWEIDER_VAPID_PUBLIC_KEY"));
  const privateKey = cleanText(Deno.env.get("KWEIDER_VAPID_PRIVATE_KEY"));

  if (!subject || !publicKey || !privateKey) {
    throw new ApiError(
      503,
      "push_configuration_missing",
      "Reward notifications are temporarily unavailable.",
    );
  }

  if (!vapidConfigured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  }
};


const updateSubscriptionAfterPush = async (
  admin: any,
  subscription: any,
  succeeded: boolean,
  statusCode = 0,
) => {
  const nowIso = new Date().toISOString();
  const expired = statusCode === 404 || statusCode === 410;
  const failureCount = succeeded
    ? 0
    : Number(subscription.failure_count || 0) + 1;

  const update: Record<string, unknown> = {
    last_seen_at: nowIso,
    updated_at: nowIso,
    failure_count: failureCount,
  };

  if (succeeded) {
    update.last_success_at = nowIso;
    update.last_failure_at = null;
    update.disabled_reason = null;
  } else {
    update.last_failure_at = nowIso;
    if (expired) {
      update.active = false;
      update.revoked_at = nowIso;
      update.disabled_reason = "push_endpoint_expired";
    } else if (failureCount >= 5) {
      update.active = false;
      update.revoked_at = nowIso;
      update.disabled_reason = "repeated_push_failure";
    }
  }

  const { error } = await admin
    .from("kweider_push_subscriptions")
    .update(update)
    .eq("id", subscription.id);

  if (error) {
    console.error("Unable to update push subscription delivery state:", error);
  }
};

const sendPushPayload = async (
  admin: any,
  subscription: any,
  payload: Record<string, unknown>,
): Promise<boolean> => {
  try {
    configureWebPush();

    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh_key,
          auth: subscription.auth_secret,
        },
      },
      JSON.stringify(payload),
      {
        TTL: 24 * 60 * 60,
        urgency: "normal",
      },
    );

    await updateSubscriptionAfterPush(admin, subscription, true);
    return true;
  } catch (error) {
    const pushError = error as any;
    const statusCode = Number(pushError?.statusCode || 0);

    let responseBody = "";
    try {
      if (typeof pushError?.body === "string") {
        responseBody = pushError.body;
      } else if (pushError?.body instanceof Uint8Array) {
        responseBody = new TextDecoder().decode(pushError.body);
      } else if (pushError?.body) {
        responseBody = String(pushError.body);
      }
    } catch {
      responseBody = "";
    }

    let endpointHost = "unknown";
    try {
      endpointHost = new URL(subscription.endpoint).host;
    } catch {
      endpointHost = "invalid-endpoint";
    }

    console.error("Web Push delivery failed", {
      statusCode,
      endpointHost,
      message: cleanText(pushError?.message).slice(0, 250),
      responseBody: responseBody.slice(0, 500),
      apnsId:
        cleanText(pushError?.headers?.["apns-id"]) ||
        cleanText(pushError?.headers?.["apns-request-id"]) ||
        null,
      contentType: cleanText(pushError?.headers?.["content-type"]) || null,
    });

    await updateSubscriptionAfterPush(
      admin,
      subscription,
      false,
      statusCode,
    );
    return false;
  }
};

const activePushSubscriptions = async (admin: any, memberId: string) => {
  const { data, error } = await admin
    .from("kweider_push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_secret, failure_count")
    .eq("member_id", memberId)
    .eq("active", true);

  if (error) {
    console.error("Unable to load active push subscriptions:", error);
    return [];
  }

  return data ?? [];
};

const sendPendingMessagesForMember = async (
  admin: any,
  memberId: string,
) => {
  const { data: member, error: memberError } = await admin
    .from("kweider_members")
    .select("notification_consent")
    .eq("id", memberId)
    .maybeSingle();

  if (memberError || !member || member.notification_consent !== true) {
    return { sent: 0, failed: 0, pending: 0 };
  }

  const nowIso = new Date().toISOString();
  const { data: messages, error: messageError } = await admin
    .from("kweider_member_messages")
    .select(
      "id, title_en, body_en, dedupe_key, message_type, created_at",
    )
    .eq("member_id", memberId)
    .eq("push_status", "pending")
    .lte("not_before", nowIso)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(10);

  if (messageError) {
    console.error("Unable to load pending push messages:", messageError);
    return { sent: 0, failed: 0, pending: 0 };
  }

  if (!messages?.length) return { sent: 0, failed: 0, pending: 0 };

  const subscriptions = await activePushSubscriptions(admin, memberId);
  if (!subscriptions.length) {
    return { sent: 0, failed: 0, pending: messages.length };
  }

  let sent = 0;
  let failed = 0;

  for (const message of messages) {
    let messageDelivered = false;

    for (const subscription of subscriptions) {
      const delivered = await sendPushPayload(admin, subscription, {
        title: cleanText(message.title_en) || "Kweider Rewards",
        body:
          cleanText(message.body_en) ||
          "You have a new Kweider reward update.",
        tag: message.dedupe_key || `kweider-${message.message_type}`,
        messageId: message.id,
      });
      messageDelivered = messageDelivered || delivered;
    }

    const deliveredAt = new Date().toISOString();
    const { error: updateError } = await admin
      .from("kweider_member_messages")
      .update({
        push_status: messageDelivered ? "sent" : "failed",
        push_sent_at: messageDelivered ? deliveredAt : null,
      })
      .eq("id", message.id)
      .eq("push_status", "pending");

    if (updateError) {
      console.error("Unable to update push message status:", updateError);
    }

    if (messageDelivered) sent += 1;
    else failed += 1;
  }

  return { sent, failed, pending: 0 };
};

const processPendingPushes = async (ctx: any) => {
  if (ctx.authMode !== "secret") {
    throw new ApiError(
      403,
      "secret_auth_required",
      "This notification worker requires secret authentication.",
    );
  }

  const nowIso = new Date().toISOString();
  const { error: inactivityError } = await ctx.supabaseAdmin.rpc(
    "kweider_queue_inactivity_reminders",
    { p_now: nowIso },
  );
  if (inactivityError) {
    console.error("Unable to queue inactivity reminders:", inactivityError);
  }

  const { data: pendingRows, error } = await ctx.supabaseAdmin
    .from("kweider_member_messages")
    .select("member_id")
    .eq("push_status", "pending")
    .lte("not_before", nowIso)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .limit(500);

  if (error) {
    throw new ApiError(
      500,
      "pending_push_query_failed",
      "Pending reward notifications could not be loaded.",
    );
  }

  const memberIds = [...new Set((pendingRows ?? []).map((row: any) => row.member_id))];
  let sent = 0;
  let failed = 0;
  let pending = 0;

  for (const memberId of memberIds) {
    const result = await sendPendingMessagesForMember(
      ctx.supabaseAdmin,
      String(memberId),
    );
    sent += result.sent;
    failed += result.failed;
    pending += result.pending;
  }

  return json({
    ok: true,
    action: "process_pending_pushes",
    membersProcessed: memberIds.length,
    sent,
    failed,
    pending,
    timestamp: nowIso,
  });
};

const updateNotificationPreference = async (
  payload: RequestPayload,
  admin: any,
) => {
  const { accessToken, memberId } = await requireMemberAccess(admin, payload.token);
  const enabled = payload.notificationConsent === true;
  const nowIso = new Date().toISOString();

  const { error: memberError } = await admin
    .from("kweider_members")
    .update({
      notification_consent: enabled,
      notification_consent_at: enabled ? nowIso : null,
      notification_consent_revoked_at: enabled ? null : nowIso,
      notification_preference_updated_at: nowIso,
    })
    .eq("id", memberId);

  if (memberError) {
    console.error("Unable to update notification preference:", memberError);
    throw new ApiError(
      500,
      "notification_preference_failed",
      "The notification preference could not be saved.",
    );
  }

  if (!enabled) {
    const { error: subscriptionError } = await admin
      .from("kweider_push_subscriptions")
      .update({
        active: false,
        revoked_at: nowIso,
        disabled_reason: "member_opt_out",
        updated_at: nowIso,
      })
      .eq("member_id", memberId)
      .eq("active", true);

    if (subscriptionError) {
      console.error("Unable to disable notification subscriptions:", subscriptionError);
      throw new ApiError(
        500,
        "notification_disable_failed",
        "Notifications could not be turned off safely.",
      );
    }
  }

  await admin
    .from("kweider_member_access_tokens")
    .update({ last_used_at: nowIso })
    .eq("id", accessToken.id);

  const bundle = await loadMemberBundle(admin, memberId);
  return json({
    ok: true,
    action: "update_notification_preference",
    ...bundle,
  });
};

const savePushSubscription = async (
  payload: RequestPayload,
  admin: any,
) => {
  const { accessToken, memberId } = await requireMemberAccess(admin, payload.token);
  const endpoint = cleanText(payload.pushEndpoint);
  const p256dh = cleanText(payload.pushP256dh);
  const auth = cleanText(payload.pushAuth);
  const deviceLabel = cleanOptionalText(payload.deviceLabel);
  const userAgent = cleanOptionalText(payload.userAgent);

  if (!endpoint || endpoint.length > 4000 || !/^https:\/\//i.test(endpoint)) {
    throw new ApiError(400, "invalid_push_endpoint", "The notification subscription is not valid.");
  }
  if (!p256dh || p256dh.length > 1000 || !auth || auth.length > 1000) {
    throw new ApiError(400, "invalid_push_keys", "The notification subscription keys are not valid.");
  }

  const { data: member, error: memberError } = await admin
    .from("kweider_members")
    .select("id, status, notification_consent")
    .eq("id", memberId)
    .maybeSingle();

  if (memberError || !member) {
    throw new ApiError(404, "member_not_found", "The membership could not be found.");
  }
  if (member.status !== "active") {
    throw new ApiError(403, "membership_unavailable", "This membership is not currently active.");
  }
  if (member.notification_consent !== true) {
    throw new ApiError(
      409,
      "notification_consent_required",
      "Enable reward notifications before registering this device.",
    );
  }

  const nowIso = new Date().toISOString();
  const { data: savedSubscription, error: subscriptionError } = await admin
    .from("kweider_push_subscriptions")
    .upsert(
      {
        member_id: memberId,
        endpoint,
        p256dh_key: p256dh,
        auth_secret: auth,
        user_agent: userAgent,
        device_label: deviceLabel,
        active: true,
        consent_at: nowIso,
        revoked_at: null,
        last_seen_at: nowIso,
        failure_count: 0,
        disabled_reason: null,
        updated_at: nowIso,
      },
      { onConflict: "endpoint" },
    )
    .select("id, endpoint, p256dh_key, auth_secret, failure_count")
    .single();

  if (subscriptionError || !savedSubscription) {
    console.error("Unable to save push subscription:", subscriptionError);
    throw new ApiError(
      500,
      "push_subscription_failed",
      "Notifications could not be enabled on this device.",
    );
  }

  const testNotificationSent = await sendPushPayload(
    admin,
    savedSubscription,
    {
      title: "Kweider Rewards",
      body: "Reward notifications are enabled on this device.",
      tag: "kweider-notifications-enabled",
    },
  );

  await admin
    .from("kweider_member_access_tokens")
    .update({ last_used_at: nowIso })
    .eq("id", accessToken.id);

  const bundle = await loadMemberBundle(admin, memberId);
  return json({
    ok: true,
    action: "save_push_subscription",
    deviceNotificationsEnabled: true,
    testNotificationSent,
    ...bundle,
  });
};

const removePushSubscription = async (
  payload: RequestPayload,
  admin: any,
) => {
  const { accessToken, memberId } = await requireMemberAccess(admin, payload.token);
  const endpoint = cleanText(payload.pushEndpoint);
  if (!endpoint) {
    throw new ApiError(400, "invalid_push_endpoint", "The notification subscription is not valid.");
  }

  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("kweider_push_subscriptions")
    .update({
      active: false,
      revoked_at: nowIso,
      last_seen_at: nowIso,
      disabled_reason: "device_opt_out",
      updated_at: nowIso,
    })
    .eq("member_id", memberId)
    .eq("endpoint", endpoint);

  if (error) {
    console.error("Unable to remove push subscription:", error);
    throw new ApiError(
      500,
      "push_unsubscribe_failed",
      "Notifications could not be turned off on this device.",
    );
  }

  await admin
    .from("kweider_member_access_tokens")
    .update({ last_used_at: nowIso })
    .eq("id", accessToken.id);

  const bundle = await loadMemberBundle(admin, memberId);
  return json({
    ok: true,
    action: "remove_push_subscription",
    deviceNotificationsEnabled: false,
    ...bundle,
  });
};

const queueNearRewardMessage = async (admin: any, bundle: any): Promise<boolean> => {
  const member = bundle?.member;
  if (!member || member.notificationConsent !== true) return false;

  const points = Number(member.points ?? 0);
  const cycle = Number(member.rewardCycle ?? 1);
  const definitions = Array.isArray(bundle.rewardDefinitions)
    ? [...bundle.rewardDefinitions].sort(
        (left: any, right: any) =>
          Number(left.thresholdPoints) - Number(right.thresholdPoints),
      )
    : [];

  const nextDefinition = definitions.find(
    (definition: any) => Number(definition.thresholdPoints) > points,
  );
  if (!nextDefinition) return false;

  const threshold = Number(nextDefinition.thresholdPoints);
  const remaining = threshold - points;
  const nearLimit = threshold >= 200 ? 20 : 10;
  if (remaining <= 0 || remaining > nearLimit) return false;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await admin
    .from("kweider_member_messages")
    .select("id", { count: "exact", head: true })
    .eq("member_id", member.id)
    .in("message_type", ["near_reward", "inactivity"])
    .gte("created_at", thirtyDaysAgo);

  if (countError) {
    console.error("Unable to count recent smart reminders:", countError);
    return false;
  }
  if (Number(count ?? 0) >= 2) return false;

  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const rewardTitle = cleanText(nextDefinition.titleEn) || "your next reward";
  const dedupeKey = `near_reward:${cycle}:${threshold}`;

  const { error } = await admin.from("kweider_member_messages").insert({
    member_id: member.id,
    message_type: "near_reward",
    title_en: `Only ${remaining} point${remaining === 1 ? "" : "s"} to ${rewardTitle}`,
    title_ar: `Only ${remaining} point${remaining === 1 ? "" : "s"} to ${rewardTitle}`,
    body_en: "You are close to your next Kweider reward.",
    body_ar: `ظ…طھط¨ظ‚ظٹ ظ„ظƒ ${remaining} ظ†ظ‚ط·ط© ظپظ‚ط· ظ„ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ ظ…ظƒط§ظپط£طھظƒ ط§ظ„طھط§ظ„ظٹط©.`,
    related_reward_id: null,
    dedupe_key: dedupeKey,
    is_read: false,
    read_at: null,
    push_status: "pending",
    push_sent_at: null,
    not_before: nowIso,
    expires_at: expiresAt,
    created_at: nowIso,
  });

  if (error) {
    if (String(error.code || "") === "23505") return false;
    console.error("Unable to queue near-reward reminder:", error);
    return false;
  }
  return true;
};

const markMessagesRead = async (
  payload: RequestPayload,
  admin: any,
) => {
  const token = cleanText(payload.token);

  if (token.length < 30) {
    throw new ApiError(
      401,
      "invalid_card_token",
      "The saved membership card is not valid.",
    );
  }

  const tokenHash = await sha256Hex(token);

  const { data: accessToken, error: accessError } = await admin
    .from("kweider_member_access_tokens")
    .select("id, member_id, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (
    accessError ||
    !accessToken ||
    accessToken.revoked_at
  ) {
    throw new ApiError(
      401,
      "invalid_card_token",
      "The saved membership card is no longer valid.",
    );
  }

  const nowIso = new Date().toISOString();

  const { error: updateError } = await admin
    .from("kweider_member_messages")
    .update({
      is_read: true,
      read_at: nowIso,
    })
    .eq("member_id", accessToken.member_id)
    .eq("is_read", false);

  if (updateError) {
    console.error(
      "Unable to mark messages as read:",
      updateError,
    );

    throw new ApiError(
      500,
      "messages_update_failed",
      "The messages could not be updated.",
    );
  }

  await admin
    .from("kweider_member_access_tokens")
    .update({ last_used_at: nowIso })
    .eq("id", accessToken.id);

  const bundle = await loadMemberBundle(
    admin,
    accessToken.member_id,
  );

  return json({
    ok: true,
    action: "mark_messages_read",
    ...bundle,
  });
};
const requireStaff = async (req: Request, ctx: any) => {
  const authorization = cleanText(req.headers.get("Authorization"));
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const accessToken = match?.[1]?.trim() ?? "";

  if (!accessToken) {
    throw new ApiError(
      401,
      "staff_login_required",
      "Sign in with an authorised staff account.",
    );
  }

  const {
    data: { user },
    error: userError,
  } = await ctx.supabaseAdmin.auth.getUser(accessToken);

  if (userError || !user || !isUuid(user.id)) {
    throw new ApiError(
      401,
      "invalid_staff_session",
      "The staff session is invalid or has expired.",
    );
  }

  const userId = user.id;

  const { data: profile, error } = await ctx.supabaseAdmin
    .from("kweider_staff_profiles")
    .select("user_id, display_name, staff_role, active")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Unable to read staff profile:", error);
    throw new ApiError(
      500,
      "staff_profile_failed",
      "The staff account could not be checked.",
    );
  }

  if (!profile || !profile.active) {
    throw new ApiError(
      403,
      "staff_not_authorised",
      "This account is not authorised for rewards operations.",
    );
  }

  return {
    userId,
    displayName: profile.display_name,
    role: profile.staff_role,
  };
};

type StaffIdentity = {
  userId: string;
  displayName: string;
  role: string;
};

const requireManager = (staff: StaffIdentity): StaffIdentity => {
  const role = cleanText(staff?.role).toLowerCase();

  if (role !== "manager" && role !== "admin") {
    throw new ApiError(
      403,
      "manager_required",
      "Manager authorisation is required for this action.",
    );
  }

  return staff;
};

const loadAllPages = async (
  loadPage: (from: number, to: number) => PromiseLike<any>,
) => {
  const rows: any[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1);

    if (error) throw error;

    const page = Array.isArray(data) ? data : [];
    rows.push(...page);

    if (page.length < pageSize) break;
  }

  return rows;
};

const loadAllMemberIds = async (ctx: any) => loadAllPages((from, to) =>
  ctx.supabaseAdmin
    .from("kweider_members")
    .select("id, notification_consent")
    .range(from, to)
);

const insertManagerBroadcastMessages = async (
  ctx: any,
  members: any[],
  broadcastId: string,
  title: string,
  body: string,
  notBefore: string,
  expiresAt: string | null,
  sendPush: boolean,
  deliveredMemberIds: Set<string>,
  reachableMemberIds: Set<string>,
) => {
  const batchSize = 500;

  for (let index = 0; index < members.length; index += batchSize) {
    const batch = members.slice(index, index + batchSize);
    const rows = batch.map((member: any) => ({
      member_id: member.id,
      message_type: "manager_broadcast",
      title_en: title,
      title_ar: title,
      body_en: body,
      body_ar: "",
      related_reward_id: null,
      dedupe_key: `${broadcastId}:${member.id}`,
      is_read: false,
      read_at: null,
      push_status: deliveredMemberIds.has(String(member.id))
        ? "sent"
        : sendPush && new Date(notBefore).getTime() <= Date.now() && member.notification_consent === true && reachableMemberIds.has(String(member.id))
          ? "pending"
          : "skipped",
      push_sent_at: deliveredMemberIds.has(String(member.id)) ? new Date().toISOString() : null,
      not_before: notBefore,
      expires_at: expiresAt,
    }));

    const { error } = await ctx.supabaseAdmin
      .from("kweider_member_messages")
      .insert(rows);

    if (error) {
      console.error("Unable to save manager broadcast messages:", error);
      throw new ApiError(
        500,
        "manager_broadcast_save_failed",
        "The customer message could not be saved.",
      );
    }
  }
};
const loadManagerAudience = async (ctx: any) => {
  try {
    const [consentingMembers, activeSubscriptions] = await Promise.all([
      loadAllPages((from, to) =>
        ctx.supabaseAdmin
          .from("kweider_members")
          .select("id")
          .eq("notification_consent", true)
          .range(from, to)
      ),
      loadAllPages((from, to) =>
        ctx.supabaseAdmin
          .from("kweider_push_subscriptions")
          .select(
            "id, member_id, endpoint, p256dh_key, auth_secret, failure_count",
          )
          .eq("active", true)
          .range(from, to)
      ),
    ]);

    const consentingMemberIds = new Set(
      consentingMembers.map((member: any) => member.id),
    );

    const targetSubscriptions = activeSubscriptions.filter(
      (subscription: any) =>
        consentingMemberIds.has(subscription.member_id),
    );

    const reachableMemberIds = new Set(
      targetSubscriptions.map((subscription: any) => subscription.member_id),
    );

    return {
      consentingMembers,
      activeSubscriptions,
      targetSubscriptions,
      reachableMemberIds,
    };
  } catch (error) {
    console.error("Unable to load manager notification audience:", error);
    throw new ApiError(
      500,
      "manager_audience_failed",
      "The notification audience could not be loaded.",
    );
  }
};

const managerStats = async (ctx: any, staff: StaffIdentity) => {
  requireManager(staff);

  const [{ count: totalMembers, error: totalError }, audience] =
    await Promise.all([
      ctx.supabaseAdmin
        .from("kweider_members")
        .select("id", { count: "exact", head: true }),
      loadManagerAudience(ctx),
    ]);

  if (totalError) {
    console.error("Unable to count members:", totalError);
    throw new ApiError(
      500,
      "manager_stats_failed",
      "The manager statistics could not be loaded.",
    );
  }

  return json({
    ok: true,
    action: "manager_stats",
    stats: {
      totalMembers: Number(totalMembers ?? 0),
      notificationConsentMembers: audience.consentingMembers.length,
      activeSubscriptions: audience.activeSubscriptions.length,
      reachableMembers: audience.reachableMemberIds.size,
      targetSubscriptions: audience.targetSubscriptions.length,
    },
  });
};

const sendManagerBroadcast = async (
  payload: RequestPayload,
  ctx: any,
  staff: StaffIdentity,
) => {
  requireManager(staff);

  const title = cleanText(payload.broadcastTitle);
  const body = cleanText(payload.broadcastBody);
  const nowIso = new Date().toISOString();
  const notBefore = cleanText(payload.broadcastStartAt) || nowIso;
  const expiresAt = cleanText(payload.broadcastEndAt) || null;
  const sendPush = payload.broadcastSendPush !== false;
  const notBeforeMs = Date.parse(notBefore);
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : null;

  if (!Number.isFinite(notBeforeMs) || (expiresAt && !Number.isFinite(expiresAtMs))) {
    throw new ApiError(400, "invalid_broadcast_dates", "Enter valid message dates.");
  }

  if (expiresAtMs !== null && expiresAtMs <= notBeforeMs) {
    throw new ApiError(400, "invalid_broadcast_dates", "The end date must be after the start date.");
  }

  if (!title || title.length > 80) {
    throw new ApiError(
      400,
      "invalid_broadcast_title",
      "Enter a notification title between 1 and 80 characters.",
    );
  }

  if (!body || body.length > 300) {
    throw new ApiError(
      400,
      "invalid_broadcast_body",
      "Enter notification text between 1 and 300 characters.",
    );
  }

  const [members, audience] = await Promise.all([
    loadAllMemberIds(ctx),
    loadManagerAudience(ctx),
  ]);
  const targetSubscriptions = audience.targetSubscriptions;
  const broadcastId = crypto.randomUUID();
  const tag = `kweider-manager-broadcast-${broadcastId}`;

  let sent = 0;
  let failed = 0;
  const deliveredMemberIds = new Set<string>();
  const batchSize = 20;

  if (sendPush && notBeforeMs <= Date.now()) {
  for (let index = 0; index < targetSubscriptions.length; index += batchSize) {
    const batch = targetSubscriptions.slice(index, index + batchSize);
    const results = await Promise.all(
      batch.map((subscription: any) =>
        sendPushPayload(ctx.supabaseAdmin, subscription, {
          title,
          body,
          tag,
        })
      ),
    );

    results.forEach((delivered: boolean, resultIndex: number) => {
      if (delivered) {
        sent += 1;
        deliveredMemberIds.add(String(batch[resultIndex]?.member_id || ""));
      } else {
        failed += 1;
      }
    });
  }

  }

  await insertManagerBroadcastMessages(
    ctx,
    members,
    broadcastId,
    title,
    body,
    notBefore,
    expiresAt,
    sendPush,
    deliveredMemberIds,
    audience.reachableMemberIds,
  );

  return json({
    ok: true,
    action: "manager_send_broadcast",
    result: {
      title,
      targetMembers: members.length,
      pushReachableMembers: audience.reachableMemberIds.size,
      targetSubscriptions: targetSubscriptions.length,
      sent,
      failed,
    },
  });
};
const findMemberForStaff = async (
  payload: RequestPayload,
  ctx: any,
  staff: { userId: string; displayName: string; role: string },
) => {
  const search = cleanText(payload.memberSearch);

  if (!search || search.length > 100) {
    throw new ApiError(
      400,
      "invalid_member_search",
      "Enter a membership code or phone number.",
    );
  }

  let member: any = null;

  if (/^KW-/i.test(search)) {
    const { data, error } = await ctx.supabaseAdmin
      .from("kweider_members")
      .select(memberSelect)
      .eq("member_code", search.toUpperCase())
      .maybeSingle();

    if (error) {
      console.error("Unable to search by membership code:", error);
      throw new ApiError(500, "member_search_failed", "The member search failed.");
    }

    member = data;
  } else {
    const { data: normalisedPhone, error: phoneError } =
      await ctx.supabaseAdmin.rpc("kweider_normalize_phone", {
        p_phone: search,
      });

    if (phoneError || !normalisedPhone) {
      throw new ApiError(
        400,
        "invalid_member_search",
        "Enter a valid membership code or phone number.",
      );
    }

    const { data, error } = await ctx.supabaseAdmin
      .from("kweider_members")
      .select(memberSelect)
      .eq("phone_e164", String(normalisedPhone))
      .maybeSingle();

    if (error) {
      console.error("Unable to search by phone:", error);
      throw new ApiError(500, "member_search_failed", "The member search failed.");
    }

    member = data;
  }

  if (!member) {
    throw new ApiError(404, "member_not_found", "No membership was found.");
  }

  const bundle = await loadMemberBundle(ctx.supabaseAdmin, member.id);
  const pinResetRequest = await latestActivePinReset(
    ctx.supabaseAdmin,
    member.id,
  );

  return json({
    ok: true,
    action: "staff_find_member",
    staff,
    pinResetRequest: formatPinResetRequest(pinResetRequest),
    ...bundle,
  });
};

const issueMemberRecoveryToken = async (
  payload: RequestPayload,
  ctx: any,
  staff: { userId: string; displayName: string; role: string },
) => {
  const memberId = cleanText(payload.memberId);

  if (!isUuid(memberId)) {
    throw new ApiError(400, "invalid_member_id", "Select a valid member.");
  }

  const { data: member, error: memberError } = await ctx.supabaseAdmin
    .from("kweider_members")
    .select("id, member_code, first_name, status")
    .eq("id", memberId)
    .maybeSingle();

  if (memberError) {
    console.error("Unable to check member for recovery:", memberError);
    throw new ApiError(
      500,
      "member_recovery_check_failed",
      "The membership could not be checked.",
    );
  }

  if (!member) {
    throw new ApiError(404, "member_not_found", "The membership could not be found.");
  }

  if (member.status !== "active") {
    throw new ApiError(
      403,
      "membership_unavailable",
      "This membership is not currently active.",
    );
  }

  const { rawToken, expiresAt } = createRecoveryToken();
  const tokenHash = await sha256Hex(rawToken);

  const { error: tokenError } = await ctx.supabaseAdmin
    .from("kweider_member_access_tokens")
    .insert({ member_id: memberId, token_hash: tokenHash });

  if (tokenError) {
    console.error("Unable to create card recovery token:", tokenError);
    throw new ApiError(
      500,
      "recovery_link_failed",
      "The card recovery link could not be created.",
    );
  }

  console.info("Card recovery link issued", {
    memberId,
    memberCode: member.member_code,
    staffUserId: staff.userId,
    expiresAt,
  });

  return json({
    ok: true,
    action: "staff_issue_recovery_token",
    recoveryToken: rawToken,
    expiresAt,
    member: {
      id: member.id,
      memberCode: member.member_code,
      firstName: member.first_name,
    },
  });
};


const approveMemberPinReset = async (
  payload: RequestPayload,
  ctx: any,
  staff: { userId: string; displayName: string; role: string },
) => {
  const memberId = cleanText(payload.memberId);
  if (!isUuid(memberId)) {
    throw new ApiError(400, "invalid_member_id", "Select a valid member.");
  }

  const { data: member, error: memberError } = await ctx.supabaseAdmin
    .from("kweider_members")
    .select("id, status")
    .eq("id", memberId)
    .maybeSingle();

  if (memberError || !member) {
    throw new ApiError(404, "member_not_found", "The membership could not be found.");
  }
  if (member.status !== "active") {
    throw new ApiError(403, "membership_unavailable", "This membership is not active.");
  }

  const request = await latestActivePinReset(ctx.supabaseAdmin, memberId);
  if (!request || request.status !== "pending") {
    throw new ApiError(404, "pin_reset_not_pending", "No card restore request is waiting for this customer.");
  }

  const { data: approved, error: approveError } = await ctx.supabaseAdmin
    .from("kweider_pin_reset_requests")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: staff.userId,
    })
    .eq("id", request.id)
    .eq("status", "pending")
    .select("id, status, requested_at, expires_at, approved_at")
    .single();

  if (approveError || !approved) {
    console.error("Unable to approve card restore:", approveError);
    throw new ApiError(409, "pin_reset_approval_failed", "The card restore request could not be approved.");
  }

  const bundle = await loadMemberBundle(ctx.supabaseAdmin, memberId);
  return json({
    ok: true,
    action: "staff_approve_pin_reset",
    staff,
    pinResetRequest: formatPinResetRequest(approved),
    ...bundle,
  });
};

const rpcApiError = (error: any): ApiError => {
  const raw = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ");

  const mappings: Array<[string, number, string, string]> = [
    ["STAFF_USER_REQUIRED", 401, "staff_login_required", "Staff login is required."],
    ["STAFF_NOT_AUTHORISED", 403, "staff_not_authorised", "This staff account is not authorised."],
    ["MEMBER_REQUIRED", 400, "member_required", "Select a member first."],
    ["MEMBER_NOT_FOUND", 404, "member_not_found", "The membership could not be found."],
    ["MEMBERSHIP_NOT_ACTIVE", 403, "membership_not_active", "This membership is not active."],
    ["INVALID_PURCHASE_AMOUNT", 400, "invalid_purchase_amount", "Enter a valid purchase amount."],
    ["PURCHASE_TOO_SMALL_FOR_POINTS", 400, "purchase_too_small", "This purchase does not earn a whole point."],
    ["INVALID_RECEIPT_REFERENCE", 400, "invalid_receipt_reference", "Enter a valid receipt reference."],
    ["INVALID_IDEMPOTENCY_KEY", 400, "invalid_request_key", "The operation reference is invalid."],
    ["IDEMPOTENCY_KEY_CONFLICT", 409, "request_key_conflict", "This operation reference was already used for another transaction."],
    ["kweider_loyalty_unique_earn_receipt", 409, "receipt_already_used", "This receipt has already been used."],
    ["LOYALTY_SETTINGS_UNAVAILABLE", 500, "settings_unavailable", "The loyalty settings are unavailable."],
    ["INVALID_MEMBER_REWARD_ID", 400, "invalid_member_reward_id", "Choose a valid available reward."],
["REWARD_NOT_FOUND", 404, "reward_not_found", "This reward could not be found."],
["REWARD_DEFINITION_UNAVAILABLE", 500, "reward_definition_unavailable", "This reward is temporarily unavailable."],
["REWARD_NOT_AVAILABLE", 409, "reward_not_available", "This reward is no longer available."],
["REWARD_EXPIRED", 409, "reward_expired", "This reward has expired."],
["UNSUPPORTED_REWARD_KIND", 400, "unsupported_reward_kind", "This reward type is not supported."],
    ["BREAKFAST_CONFIRMATION_REQUIRED", 400, "breakfast_confirmation_required", "Confirm that the order contains the eligible breakfast for two."],
    ["CHECKOUT_IDEMPOTENCY_CONFLICT", 409, "checkout_request_conflict", "This checkout reference was already used for different details."],
  ];

  for (const [marker, status, code, message] of mappings) {
    if (raw.includes(marker)) return new ApiError(status, code, message);
  }

  console.error("Unexpected database operation error:", error);
  return new ApiError(
    500,
    "rewards_operation_failed",
    "The rewards operation could not be completed.",
  );
};

const addPurchasePoints = async (
  payload: RequestPayload,
  ctx: any,
  staff: { userId: string; displayName: string; role: string },
) => {
  const memberId = cleanText(payload.memberId);
  const purchaseAmount = Number(payload.purchaseAmount);
  const receiptReference = cleanText(payload.receiptReference);
  const idempotencyKey = cleanText(payload.idempotencyKey);

  if (!isUuid(memberId)) {
    throw new ApiError(400, "invalid_member_id", "Select a valid member.");
  }

  if (!Number.isFinite(purchaseAmount)) {
    throw new ApiError(
      400,
      "invalid_purchase_amount",
      "Enter a valid purchase amount.",
    );
  }

  const { data, error } = await ctx.supabaseAdmin.rpc(
    "kweider_staff_add_purchase_points",
    {
      p_staff_user_id: staff.userId,
      p_member_id: memberId,
      p_purchase_amount: purchaseAmount,
      p_receipt_reference: receiptReference,
      p_idempotency_key: idempotencyKey,
    },
  );

  if (error) throw rpcApiError(error);

  let bundle = await loadMemberBundle(ctx.supabaseAdmin, memberId);
  const reminderQueued = await queueNearRewardMessage(ctx.supabaseAdmin, bundle);
  if (reminderQueued) {
    bundle = await loadMemberBundle(ctx.supabaseAdmin, memberId);
  }
  const pushDelivery = await sendPendingMessagesForMember(
    ctx.supabaseAdmin,
    memberId,
  );

  return json({
    ok: true,
    action: "staff_add_purchase_points",
    staff,
    operation: data,
    pushDelivery,
    ...bundle,
  });
};

const redeemMemberReward = async (
  payload: RequestPayload,
  ctx: any,
  staff: {
    userId: string;
    displayName: string;
    role: string;
  },
) => {
  const memberId = cleanText(payload.memberId);
  const memberRewardId = cleanText(
    payload.memberRewardId,
  );
  const receiptReference = cleanText(
    payload.receiptReference,
  );
  const idempotencyKey = cleanText(
    payload.idempotencyKey,
  );

  const rawPurchaseAmount = payload.purchaseAmount;
  const purchaseAmount = rawPurchaseAmount === null || rawPurchaseAmount === undefined || (typeof rawPurchaseAmount === "string" && rawPurchaseAmount.trim() === "") ? null : Number(rawPurchaseAmount);
  if (!isUuid(memberId)) {
    throw new ApiError(
      400,
      "invalid_member_id",
      "Select a valid member.",
    );
  }

  if (!isUuid(memberRewardId)) {
    throw new ApiError(
      400,
      "invalid_member_reward_id",
      "Choose a valid available reward.",
    );
  }

  if (
    purchaseAmount !== null &&
    !Number.isFinite(purchaseAmount)
  ) {
    throw new ApiError(
      400,
      "invalid_purchase_amount",
      "Enter a valid purchase amount.",
    );
  }

  const { data, error } =
    await ctx.supabaseAdmin.rpc(
      "kweider_staff_redeem_member_reward",
      {
        p_staff_user_id: staff.userId,
        p_member_id: memberId,
        p_member_reward_id: memberRewardId,
        p_purchase_amount: purchaseAmount,
        p_receipt_reference:
          receiptReference || null,
        p_idempotency_key: idempotencyKey,
      },
    );

  if (error) {
    throw rpcApiError(error);
  }

  const bundle = await loadMemberBundle(
    ctx.supabaseAdmin,
    memberId,
  );
  const pushDelivery = await sendPendingMessagesForMember(
    ctx.supabaseAdmin,
    memberId,
  );

  return json({
    ok: true,
    action: "staff_redeem_member_reward",
    staff,
    operation: data,
    pushDelivery,
    ...bundle,
  });
};


const completeCheckout = async (
  payload: RequestPayload,
  ctx: any,
  staff: {
    userId: string;
    displayName: string;
    role: string;
  },
) => {
  const memberId = cleanText(payload.memberId);
  const rawPurchaseAmount = payload.purchaseAmount;
  const purchaseAmount = Number(rawPurchaseAmount);
  const selectedMemberRewardId = cleanText(payload.memberRewardId);
  const breakfastConfirmed = payload.breakfastConfirmed === true;
  const welcomeCoffeeConfirmed = payload.welcomeCoffeeConfirmed === true;
  const receiptReference = cleanText(payload.receiptReference);
  const idempotencyKey = cleanText(payload.idempotencyKey);

  if (!isUuid(memberId)) {
    throw new ApiError(
      400,
      "invalid_member_id",
      "Select a valid member.",
    );
  }

  if (!Number.isFinite(purchaseAmount) || purchaseAmount < 0) {
    throw new ApiError(
      400,
      "invalid_purchase_amount",
      "Enter a valid bill amount.",
    );
  }

  if (
    selectedMemberRewardId &&
    !isUuid(selectedMemberRewardId)
  ) {
    throw new ApiError(
      400,
      "invalid_member_reward_id",
      "The reward selected by the customer is not valid.",
    );
  }

  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new ApiError(
      400,
      "invalid_request_key",
      "The checkout reference is invalid.",
    );
  }

  const { data, error } = await ctx.supabaseAdmin.rpc(
    "kweider_staff_complete_checkout",
    {
      p_staff_user_id: staff.userId,
      p_member_id: memberId,
      p_purchase_amount: purchaseAmount,
      p_idempotency_key: idempotencyKey,
      p_selected_member_reward_id:
        selectedMemberRewardId || null,
      p_breakfast_confirmed: breakfastConfirmed,
      p_receipt_reference: receiptReference || null,
    },
  );

  if (error) {
    throw rpcApiError(error);
  }

  let welcomeCoffeeRedemption: Record<string, unknown> | null = null;
  let welcomeCoffeeWarning = "";

  if (welcomeCoffeeConfirmed) {
    const { data: coffeeData, error: coffeeError } =
      await ctx.supabaseAdmin.rpc("kweider_redeem_welcome_coffee", {
        p_staff_user_id: staff.userId,
        p_member_id: memberId,
        p_purchase_amount: purchaseAmount,
        p_receipt_reference: receiptReference || null,
        p_idempotency_key: idempotencyKey,
      });

    if (coffeeError) {
      console.error(
        "Checkout completed but welcome coffee was not marked:",
        coffeeError,
      );
      welcomeCoffeeWarning =
        "Checkout completed, but the welcome coffee was not marked as used. Ask a manager to review it.";
    } else {
      welcomeCoffeeRedemption =
        coffeeData && typeof coffeeData === "object" ? coffeeData : null;
    }
  }

  let bundle = await loadMemberBundle(
    ctx.supabaseAdmin,
    memberId,
  );
  const reminderQueued = await queueNearRewardMessage(ctx.supabaseAdmin, bundle);
  if (reminderQueued) {
    bundle = await loadMemberBundle(ctx.supabaseAdmin, memberId);
  }
  const pushDelivery = await sendPendingMessagesForMember(
    ctx.supabaseAdmin,
    memberId,
  );

  return json({
    ok: true,
    action: "staff_complete_checkout",
    staff,
    operation: data,
    welcomeCoffeeRedemption,
    welcomeCoffeeWarning,
    pushDelivery,
    ...bundle,
  });
};

console.info("Kweider Rewards API v4.4.0 started");

const rewardsApiFetch = withSupabase(
  {
    // Every browser request must include the publishable key in `apikey`.
    // Staff JWTs are verified separately inside staff-only actions.
    auth: ["publishable", "secret"],
  },
  async (req, ctx) => {
      try {
        let payload: RequestPayload = {};

        try {
          payload = await req.json();
        } catch {
          throw new ApiError(400, "invalid_json", "Send a valid JSON request.");
        }

        const action = payload.action ?? "health";

        if (action === "health") {
          return json({
            ok: true,
            service: "kweider-rewards-api",
            version: "4.4.0",
            action: "health",
            authMode: ctx.authMode,
            timestamp: new Date().toISOString(),
          });
        }

        if (action === "create_member") {
          return await createMembership(payload, ctx.supabaseAdmin);
        }

        if (action === "login_with_pin") {
          return await loginWithPin(payload, ctx.supabaseAdmin);
        }

        if (action === "set_member_pin") {
          return await setMemberPin(payload, ctx.supabaseAdmin);
        }

        if (action === "request_pin_reset") {
          return await requestPinReset(payload, ctx.supabaseAdmin);
        }

        if (action === "check_pin_reset") {
          return await checkPinReset(payload, ctx.supabaseAdmin);
        }

        if (action === "complete_pin_reset") {
          return await completePinReset(payload, ctx.supabaseAdmin);
        }

        if (action === "get_card") {
          return await openSavedCard(payload, ctx.supabaseAdmin);
        }

        if (action === "recover_card") {
          return await recoverMemberCard(payload, ctx.supabaseAdmin);
        }

        if (action === "mark_messages_read") {
          return await markMessagesRead(payload, ctx.supabaseAdmin);
        }

        if (action === "update_notification_preference") {
          return await updateNotificationPreference(payload, ctx.supabaseAdmin);
        }

        if (action === "save_push_subscription") {
          return await savePushSubscription(payload, ctx.supabaseAdmin);
        }

        if (action === "remove_push_subscription") {
          return await removePushSubscription(payload, ctx.supabaseAdmin);
        }

        if (action === "process_pending_pushes") {
          return await processPendingPushes(ctx);
        }

        if (
          action === "staff_me" ||
          action === "staff_find_member" ||
          action === "staff_issue_recovery_token" ||
          action === "staff_approve_pin_reset" ||
          action === "staff_complete_checkout" ||
          action === "staff_add_purchase_points" ||
          action === "staff_redeem_member_reward" ||
          action === "manager_stats" ||
          action === "manager_send_broadcast"
        ) {
          const staff = await requireStaff(req, ctx);

          if (action === "staff_me") {
            return json({ ok: true, action: "staff_me", staff });
          }

          if (action === "manager_stats") {
            return await managerStats(ctx, requireManager(staff));
          }

          if (action === "manager_send_broadcast") {
            return await sendManagerBroadcast(
              payload,
              ctx,
              requireManager(staff),
            );
          }

          if (action === "staff_find_member") {
            return await findMemberForStaff(payload, ctx, staff);
          }

          if (action === "staff_issue_recovery_token") {
            return await issueMemberRecoveryToken(payload, ctx, requireManager(staff));
          }

          if (action === "staff_approve_pin_reset") {
            return await approveMemberPinReset(payload, ctx, staff);
          }

          if (action === "staff_complete_checkout") {
            return await completeCheckout(payload, ctx, staff);
          }

          if (action === "staff_add_purchase_points") {
            return await addPurchasePoints(payload, ctx, requireManager(staff));
          }

          return await redeemMemberReward(payload, ctx, requireManager(staff));
        }

        throw new ApiError(
          400,
          "unknown_action",
          "The requested action is not supported.",
        );
      } catch (error) {
        if (error instanceof ApiError) {
          return json(
            { ok: false, code: error.code, message: error.message },
            error.status,
          );
        }

        console.error("Unexpected Rewards API error:", error);
        return json(
          {
            ok: false,
            code: "internal_error",
            message: "An unexpected error occurred. Please try again.",
          },
          500,
        );
      }
  },
);

export default {
  fetch(req: Request) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return json(
        { ok: false, code: "method_not_allowed", message: "Use POST for this endpoint." },
        405,
      );
    }

    return rewardsApiFetch(req);
  },
};
