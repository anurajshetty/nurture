/**
 * Partner invite codes (mockup 33) — client contract tests.
 *
 * Pure logic only: code normalization/format, RPC error classification,
 * single-use redeem mapping, role/linked kv persistence. No network, no
 * native modules — the RPC client is injected as a fake.
 *
 * Run with:
 *   npx tsc tests/partner_invites.test.ts src/partner/inviteCodes.ts \
 *     --outDir /tmp/nurture-partner-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-partner-tests/tests/partner_invites.test.js
 */

import {
  CODE_LENGTH,
  ONBOARDING_ROLE_KEY,
  PARTNER_LINKED_KEY,
  PARTNER_ONBOARDING_DONE_KEY,
  classifyRpcError,
  clearOnboardingRole,
  getLinkedOwnerId,
  getMyInviteCode,
  getOnboardingRole,
  getOwnerLinkStatus,
  isPartnerLinked,
  isPartnerOnboardingDone,
  isValidCodeFormat,
  normalizeCode,
  redeemInviteCode,
  revokePartnerLink,
  setOnboardingRole,
  setPartnerLinked,
  setPartnerOnboardingDone,
  type InviteKv,
  type PartnerRpc,
} from '../src/partner/inviteCodes';

declare const process: { exit(code: number): void };

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`, extra ?? '');
  }
}

function fakeKv(): InviteKv & { store: Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    store,
    get: (k) => (k in store ? store[k] : null),
    set: (k, v) => {
      store[k] = v;
    },
  };
}

function fakeRpc(
  impl: (fn: string, params?: Record<string, unknown>) => { data: unknown; error: { code?: string; message: string } | null },
): PartnerRpc {
  return {
    rpc: async (fn, params) => impl(fn, params),
  };
}

// --- code format -----------------------------------------------------------
check('code length is 6', CODE_LENGTH === 6);
check('normalizes lowercase + trims', normalizeCode('  k7x2qm ') === 'K7X2QM');
check('strips dashes and spaces', normalizeCode('K7-X2 QM') === 'K7X2QM');
check('caps at 6 chars', normalizeCode('ABCDEFGH') === 'ABCDEF');
check('empty normalizes to empty', normalizeCode('') === '');
check('valid format: 6 unambiguous chars', isValidCodeFormat('K7X2QM'));
check('rejects short code', !isValidCodeFormat('K7X2Q'));
check('rejects ambiguous O', !isValidCodeFormat('K7X2OM'));
check('rejects ambiguous 0', !isValidCodeFormat('K7X20M'));
check('rejects ambiguous I', !isValidCodeFormat('K7X2IM'));
check('rejects ambiguous 1', !isValidCodeFormat('K7X21M'));
check('rejects lowercase', !isValidCodeFormat('k7x2qm'));

// --- error classification --------------------------------------------------
check(
  '42883 -> not_ready (migration not applied)',
  classifyRpcError({ code: '42883', message: 'function public.create_partner_invite() does not exist' }) === 'not_ready',
);
check(
  'does-not-exist message -> not_ready',
  classifyRpcError({ message: 'Could not find the function public.redeem_partner_invite' }) === 'not_ready',
);
check(
  'network failure -> network',
  classifyRpcError({ message: 'Network request failed' }) === 'network',
);
check('other server error -> unknown', classifyRpcError({ code: 'P0001', message: 'boom' }) === 'unknown');
check('thrown string -> unknown', classifyRpcError('weird') === 'unknown');

// --- role + linked kv ------------------------------------------------------
{
  const kv = fakeKv();
  check('no role initially', getOnboardingRole(kv) === null);
  setOnboardingRole(kv, 'partner');
  check('role persists', getOnboardingRole(kv) === 'partner' && kv.store[ONBOARDING_ROLE_KEY] === 'partner');
  setOnboardingRole(kv, 'mom');
  check('role switches', getOnboardingRole(kv) === 'mom');
  check('not linked initially', !isPartnerLinked(kv));
  setPartnerLinked(kv);
  check('linked persists', isPartnerLinked(kv) && kv.store[PARTNER_LINKED_KEY] === '1');
  check('partner onboarding not done initially', !isPartnerOnboardingDone(kv));
  setPartnerOnboardingDone(kv);
  check('partner onboarding done persists',
    isPartnerOnboardingDone(kv) && kv.store[PARTNER_ONBOARDING_DONE_KEY] === '1');
  clearOnboardingRole(kv);
  check('clearing the role re-asks the split', getOnboardingRole(kv) === null);
  // Clearing the role must not wipe the linked/done record.
  check('linked survives role clear', isPartnerLinked(kv));
  check('done survives role clear', isPartnerOnboardingDone(kv));
}

async function main() {
  // --- getMyInviteCode -----------------------------------------------------
  {
    const r = await getMyInviteCode(null);
    check('null client -> not_configured', r.status === 'not_configured' && r.code === undefined);
  }
  {
    const r = await getMyInviteCode(fakeRpc(() => ({ data: [{ code: 'K7X2QM' }], error: null })));
    check('happy path returns code', r.status === 'ok' && r.code === 'K7X2QM');
  }
  {
    const r = await getMyInviteCode(
      fakeRpc(() => ({ data: null, error: { code: '42883', message: 'function does not exist' } })),
    );
    check('missing function -> not_ready, never throws', r.status === 'not_ready');
  }
  {
    const r = await getMyInviteCode(fakeRpc(() => ({ data: [{ code: 'SHORT' }], error: null })));
    check('malformed code -> unknown', r.status === 'unknown');
  }
  {
    const r = await getMyInviteCode({
      rpc: async () => {
        throw new Error('Network request failed');
      },
    });
    check('thrown network error -> network', r.status === 'network');
  }

  // --- redeemInviteCode ----------------------------------------------------
  {
    const r = await redeemInviteCode('K7X2QM', null);
    check('null client -> not_configured', r.status === 'not_configured');
  }
  {
    const r = await redeemInviteCode('K7X2', fakeRpc(() => ({ data: null, error: null })));
    check('bad format never hits the server', r.status === 'invalid_code');
  }
  {
    let called = false;
    const r = await redeemInviteCode(
      'k7x2qm',
      fakeRpc((fn, params) => {
        called = true;
        check('redeem normalizes to uppercase', params?.p_code === 'K7X2QM');
        return { data: 'owner-uuid', error: null };
      }),
    );
    check('valid code -> ok', r.status === 'ok' && called);
  }
  {
    // Single-use: unknown and already-used codes both read as invalid_code.
    for (const msg of ['invalid_code', 'INVALID_CODE: already redeemed']) {
      const r = await redeemInviteCode(
        'K7X2QM',
        fakeRpc(() => ({ data: null, error: { code: 'P0001', message: msg } })),
      );
      check(`server '${msg}' -> invalid_code`, r.status === 'invalid_code');
    }
  }
  {
    const r = await redeemInviteCode(
      'K7X2QM',
      fakeRpc(() => ({ data: null, error: { code: '42883', message: 'nope' } })),
    );
    check('missing redeem function -> not_ready', r.status === 'not_ready');
  }

  // --- revokePartnerLink ---------------------------------------------------
  {
    const r = await revokePartnerLink(null);
    check('null client -> not_configured', r.status === 'not_configured');
  }
  {
    const r = await revokePartnerLink(fakeRpc(() => ({ data: null, error: null })));
    check('revoke happy path -> ok', r.status === 'ok');
  }
  {
    const r = await revokePartnerLink(
      fakeRpc(() => ({ data: null, error: { code: 'P0001', message: 'no_partner_link' } })),
    );
    check('no link -> no_partner_link', r.status === 'no_partner_link');
  }

  // --- getLinkedOwnerId ----------------------------------------------------
  {
    const r = await getLinkedOwnerId(null);
    check('null client -> not_configured', r.status === 'not_configured');
  }
  {
    const r = await getLinkedOwnerId(fakeRpc(() => ({ data: 'owner-1', error: null })));
    check('linked owner returned', r.status === 'ok' && r.ownerId === 'owner-1');
  }
  {
    const r = await getLinkedOwnerId(fakeRpc(() => ({ data: null, error: null })));
    check('no link -> null ownerId', r.status === 'ok' && r.ownerId === null);
  }

  // --- getOwnerLinkStatus ------------------------------------------------
  {
    const r = await getOwnerLinkStatus(null);
    check('null client -> not_configured', r.status === 'not_configured');
  }
  {
    const r = await getOwnerLinkStatus(
      fakeRpc(() => ({ data: null, error: null })),
    );
    check('client without from() -> not_configured', r.status === 'not_configured');
  }
  {
    const withFrom = (rows: unknown): PartnerRpc => ({
      rpc: async () => ({ data: null, error: null }),
      from: () => ({ select: async () => ({ data: rows, error: null }) }),
    });
    const none = await getOwnerLinkStatus(withFrom([]));
    check('no invites -> not connected', none.status === 'ok' && none.connected === false);
    const pending = await getOwnerLinkStatus(
      withFrom([{ redeemed_by: null, revoked_at: null }]),
    );
    check('unredeemed invite -> not connected', pending.status === 'ok' && pending.connected === false);
    const linked = await getOwnerLinkStatus(
      withFrom([{ redeemed_by: 'partner-1', revoked_at: null }]),
    );
    check('redeemed invite -> connected', linked.status === 'ok' && linked.connected === true);
    const revoked = await getOwnerLinkStatus(
      withFrom([{ redeemed_by: 'partner-1', revoked_at: '2026-09-21T00:00:00Z' }]),
    );
    check('revoked invite -> not connected', revoked.status === 'ok' && revoked.connected === false);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.log('  FAIL uncaught', e);
  process.exit(1);
});
