import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { webcrypto, createHash } from 'node:crypto';

// Execute the real handler with network-free Supabase and runtime adapters.
// No credentials, customer records, or production connections are used.
const path = process.env.AUTH_TEST_SOURCE || new URL('../edge-functions/kweider-rewards-api/index.ts', import.meta.url);
const source = readFileSync(path, 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export default {', 'globalThis.handler = {');
const compiled = stripTypeScriptTypes(source, { mode: 'transform' });
const token = 'A'.repeat(43);
const memberId = '11111111-1111-4111-8111-111111111111';
const tokenRow = { id: 'token-fixture', member_id: memberId, revoked_at: null };
const member = { id: memberId, status: 'active', points_balance: 27, reward_cycle: 1 };

function harness(options = {}) {
  const reads = [], writes = [];
  const admin = {
    auth: { getUser: async () => ({ data: { user: options.user || null }, error: null }) },
    from(table) {
      let operation = 'select', values, columns;
      const filters = [];
      const query = {
        select(v) { columns = v; return this; },
        update(v) { operation = 'update'; values = v; return this; },
        insert(v) { operation = 'insert'; values = v; return this; },
        delete() { operation = 'delete'; return this; },
        eq(...v) { filters.push(v); return this; },
        is(...v) { filters.push(v); return this; },
        lte() { return this; }, or() { return this; }, order() { return this; }, limit() { return this; },
        single() { return this; }, maybeSingle() { return this; },
        then(resolve, reject) {
          if (operation !== 'select') {
            writes.push({ table, operation, values, filters });
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          reads.push({ table, columns, filters });
          let data = [], error = null;
          if (table === 'kweider_member_access_tokens') {
            data = options.missing ? null : { ...tokenRow, revoked_at: options.revoked ? '2026-01-01' : null };
            if (options.tokenError) error = { message: 'unavailable' };
          }
          if (table === 'kweider_members') {
            data = options.missingMember ? null : { ...member, status: options.status || 'active' };
            if (options.memberError) error = { message: 'unavailable' };
          }
          if (table === 'kweider_loyalty_settings') data = { points_per_pound: 1, points_per_reward: 100, reward_value: 5 };
          if (table === 'kweider_welcome_coffees') data = null;
          if (table === 'kweider_staff_profiles') data = options.profile || null;
          return Promise.resolve({ data, error }).then(resolve, reject);
        },
      };
      return query;
    },
    rpc() { throw new Error('Unexpected RPC: this test must not invoke a database function'); },
  };
  const context = {
    Request, Response, Headers, URL, URLSearchParams, TextEncoder, Uint8Array, Uint32Array,
    crypto: webcrypto, btoa, atob,
    console: { info() {}, error() {}, warn() {} },
    Deno: { env: { get: name => name === 'KWEIDER_PIN_PEPPER' ? 'test-only-pepper' : undefined } },
    withSupabase: (_config, fn) => req => fn(req, { supabaseAdmin: admin, authMode: 'publishable' }),
    fetch() { throw new Error('Network is forbidden in auth tests'); },
  };
  runInNewContext(compiled, context);
  return {
    reads, writes,
    async call(action, extra = {}, headers = {}) {
      const response = await context.handler.fetch(new Request('https://local.invalid/rewards', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://menu.kweidersweets.co.uk', ...headers },
        body: JSON.stringify({ action, token, pin: '1234', ...extra }),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

const memberActions = ['get_card', 'set_member_pin', 'mark_messages_read', 'update_notification_preference', 'save_push_subscription', 'remove_push_subscription'];
for (const action of memberActions) {
  for (const [label, credential] of [
    ['expired recovery', `rec_${(Date.now() - 60000).toString(36)}_${token}`],
    ['unexpired recovery', `rec_${(Date.now() + 60000).toString(36)}_${token}`],
    ['PIN reset', `pinreset_${(Date.now() + 60000).toString(36)}_${token}`],
  ]) {
    test(`${action} rejects ${label} credential before DB access`, async () => {
      const h = harness();
      const r = await h.call(action, { token: credential });
      assert.equal(r.status, 401);
      assert.equal(r.body.code, 'recovery_token_required');
      assert.equal(h.reads.length, 0);
      assert.equal(h.writes.length, 0);
    });
  }
  for (const [options, status] of [[{ missing: true }, 401], [{ revoked: true }, 401], [{ tokenError: true }, 401], [{ status: 'suspended' }, 403], [{ status: 'closed' }, 403], [{ missingMember: true }, 403], [{ memberError: true }, 503]]) {
    test(`${action} denies ${JSON.stringify(options)} without writes`, async () => {
      const h = harness(options);
      assert.equal((await h.call(action)).status, status);
      assert.equal(h.writes.length, 0);
    });
  }
}

test('existing permanent card still opens and only updates last_used_at', async () => {
  const h = harness();
  const r = await h.call('get_card');
  assert.equal(r.status, 200);
  assert.equal(r.body.member.points, 27);
  assert.deepEqual(h.writes.map(w => w.table), ['kweider_member_access_tokens']);
  assert.deepEqual(Object.keys(h.writes[0].values), ['last_used_at']);
  assert.equal(h.reads[0].filters[0][1], createHash('sha256').update(token).digest('hex'));
});

test('older permanent token format remains accepted', async () => {
  const h = harness();
  assert.equal((await h.call('get_card', { token: 'legacy-card-token-'.repeat(3) })).status, 200);
});

test('valid permanent card can set PIN without touching balances or rewards', async () => {
  const h = harness();
  assert.equal((await h.call('set_member_pin')).status, 200);
  assert.deepEqual(h.writes.map(w => w.table), ['kweider_members']);
  assert.ok(Object.keys(h.writes[0].values).every(k => k.startsWith('access_pin_')));
  assert.equal(h.writes[0].values.access_pin_hash.length, 64);
});

test('valid permanent card can mark its own messages read', async () => {
  const h = harness();
  assert.equal((await h.call('mark_messages_read')).status, 200);
  assert.deepEqual(h.writes.map(w => w.table), ['kweider_member_messages', 'kweider_member_access_tokens']);
  assert.equal(h.writes[0].filters[0][1], memberId);
});

for (const action of ['staff_me', 'manager_stats', 'staff_find_member', 'staff_issue_recovery_token', 'staff_approve_pin_reset']) {
  test(`${action} still requires a staff session`, async () => {
    const h = harness();
    assert.equal((await h.call(action)).status, 401);
    assert.equal(h.writes.length, 0);
  });
}
test('ordinary staff cannot access manager routes', async () => {
  const h = harness({ user: { id: memberId }, profile: { active: true, staff_role: 'staff', user_id: memberId } });
  assert.equal((await h.call('manager_stats', {}, { Authorization: 'Bearer fixture-jwt' })).status, 403);
  assert.equal(h.writes.length, 0);
});
test('unapproved reset cannot issue a card', async () => {
  const h = harness();
  assert.notEqual((await h.call('complete_pin_reset', { resetToken: `pinreset_${(Date.now() + 60000).toString(36)}_${token}` })).status, 200);
  assert.equal(h.writes.length, 0);
});
