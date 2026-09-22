/**
 * Partner invite codes — NAMED-INVITE contract tests (mockup 33 rev C).
 *
 * Regression + contract suite for the revised partner-sharing model:
 * every code is a named invite; name + code bind at redemption; the
 * partners list shows named invites only (pending "Name · Invited" /
 * accepted name + remove); max 5 (pending + accepted).
 *
 * Pure logic only: no network, no native modules — the RPC client is
 * injected as a fake.
 *
 * Run with:
 *   npx tsc tests/partner_invites.test.ts src/partner/inviteCodes.ts \
 *     --outDir /tmp/nurture-partner-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-partner-tests/tests/partner_invites.test.js
 */

import {
  CODE_LENGTH,
  MAX_PARTNERS,
  ONBOARDING_ROLE_KEY,
  PARTNER_LINKED_KEY,
  PARTNER_ONBOARDING_DONE_KEY,
  classifyRpcError,
  clearOnboardingRole,
  createNamedInvite,
  getLinkedOwnerId,
  getOnboardingRole,
  getPartnerInvites,
  isPartnerLinked,
  isPartnerOnboardingDone,
  isValidCodeFormat,
  isValidName,
  normalizeCode,
  normalizeName,
  redeemInvite,
  revokePartnerInvite,
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

type RpcResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

function fakeRpc(handler: (fn: string, params?: Record<string, unknown>) => RpcResult): PartnerRpc {
  return {
    rpc: async (fn, params) => handler(fn, params),
  };
}

const ok = (data: unknown): RpcResult => ({ data, error: null });
const err = (message: string, code?: string): RpcResult => ({
  data: null,
  error: { code, message },
});

function param(p: Record<string, unknown> | undefined, key: string): unknown {
  return p?.[key];
}

async function main() {
  console.log('code format:');
  check('CODE_LENGTH is 6', CODE_LENGTH === 6);
  check('normalizes lowercase + strips dashes', normalizeCode('k7-x2qm') === 'K7X2QM');
  check('truncates to 6', normalizeCode('ABCDEFGH') === 'ABCDEF');
  check('accepts unambiguous 6-char', isValidCodeFormat('K7X2QM'));
  check('rejects ambiguous chars', !isValidCodeFormat('K70X2M'));
  check('rejects short codes', !isValidCodeFormat('K7X2Q'));

  console.log('name normalization:');
  check('trims whitespace', normalizeName('  Sam  ') === 'Sam');
  check('caps at 30 chars', normalizeName('x'.repeat(40)).length === 30);
  check('blank name invalid', !isValidName('   '));
  check('empty name invalid', !isValidName(''));
  check('real name valid', isValidName('Maya'));

  console.log('error classification:');
  check('42883 -> not_ready', classifyRpcError({ code: '42883', message: 'x' }) === 'not_ready');
  check(
    'function-missing message -> not_ready',
    classifyRpcError({ message: 'Could not find the function public.create_partner_invite' }) ===
      'not_ready',
  );
  check('fetch failure -> network', classifyRpcError({ message: 'failed to fetch' }) === 'network');
  check('other -> unknown', classifyRpcError({ message: 'boom' }) === 'unknown');

  console.log('createNamedInvite:');
  {
    let seenParams: Record<string, unknown> | undefined;
    const rpc = fakeRpc((_fn, params) => {
      seenParams = params;
      return ok([{ code: 'K7X2QM' }]);
    });
    const r = await createNamedInvite('Sam', rpc);
    check('ok returns the code', r.status === 'ok' && r.code === 'K7X2QM', r);
    check('create passes p_name', param(seenParams, 'p_name') === 'Sam', seenParams);
  }
  {
    // name is required BEFORE any RPC (a code abandoned before naming
    // never exists server-side)
    let called = false;
    const rpc = fakeRpc(() => {
      called = true;
      return ok([{ code: 'K7X2QM' }]);
    });
    const r = await createNamedInvite('   ', rpc);
    check('blank name -> name_required without RPC', r.status === 'name_required' && !called, r);
  }
  {
    const rpc = fakeRpc(() => err('max_partners_reached'));
    const r = await createNamedInvite('Noah', rpc);
    check('maxed out -> max_partners', r.status === 'max_partners', r);
  }
  {
    const rpc = fakeRpc(() => err('does not exist', '42883'));
    const r = await createNamedInvite('Noah', rpc);
    check('missing function -> not_ready', r.status === 'not_ready', r);
  }
  {
    const rpc = fakeRpc(() => ok([{ code: 'BOGUS!' }]));
    const r = await createNamedInvite('Noah', rpc);
    check('malformed code -> unknown', r.status === 'unknown', r);
  }
  {
    const r = await createNamedInvite('Noah', null);
    check('no rpc -> not_configured', r.status === 'not_configured', r);
  }

  console.log('redeemInvite (name binds):');
  {
    let seenFn = '';
    let seenParams: Record<string, unknown> | undefined;
    const rpc = fakeRpc((fn, params) => {
      seenFn = fn;
      seenParams = params;
      return ok('owner-uuid-1');
    });
    const r = await redeemInvite('k7x2qm', '  sam ', rpc);
    check('valid pair -> ok', r.status === 'ok', r);
    check('redeem calls redeem_partner_invite', seenFn === 'redeem_partner_invite', seenFn);
    check(
      'redeem sends normalized code+name',
      param(seenParams, 'p_code') === 'K7X2QM' && param(seenParams, 'p_name') === 'sam',
      seenParams,
    );
    check('owner name null on legacy response', r.ownerName === null, r.ownerName);
  }
  {
    // Mockup 34: the server returns her name; the client surfaces it for
    // "{her name}'s journey".
    const rpc = fakeRpc(() => ok([{ owner_id: 'owner-uuid-1', owner_name: 'Sushmitha' }]));
    const r = await redeemInvite('K7X2QM', 'Sam', rpc);
    check('owner name surfaces', r.status === 'ok' && r.ownerName === 'Sushmitha', r);
  }
  {
    const rpc = fakeRpc(() => ok([{ owner_id: 'owner-uuid-1', owner_name: '  ' }]));
    const r = await redeemInvite('K7X2QM', 'Sam', rpc);
    check('blank owner name -> null', r.status === 'ok' && r.ownerName === null, r);
  }
  {
    // wrong name is invalid, same as a wrong code — the client only ever
    // shows the warm invalid copy
    const rpc = fakeRpc(() => err('invalid_code'));
    const r = await redeemInvite('K7X2QM', 'Noah', rpc);
    check('server wrong-name -> invalid_code', r.status === 'invalid_code', r);
  }
  {
    let called = false;
    const rpc = fakeRpc(() => {
      called = true;
      return ok('x');
    });
    const r = await redeemInvite('K7X2QM', '   ', rpc);
    check('blank name never reaches the server', r.status === 'invalid_code' && !called, r);
    const r2 = await redeemInvite('SHORT', 'Sam', rpc);
    check('bad code never reaches the server', r2.status === 'invalid_code' && !called, r2);
  }
  {
    const r = await redeemInvite('K7X2QM', 'Sam', null);
    check('no rpc -> not_configured', r.status === 'not_configured', r);
  }

  console.log('getPartnerInvites:');
  {
    const rpc = fakeRpc(() => ok([
      { invite_id: 'id-1', partner_name: 'Sam', status: 'accepted' },
      { invite_id: 'id-2', partner_name: 'Maya', status: 'pending' },
    ]));
    const r = await getPartnerInvites(rpc);
    check('ok with 2 invites', r.status === 'ok' && r.invites?.length === 2, r);
    check('accepted maps through', r.invites?.[0]?.status === 'accepted' && r.invites?.[0]?.name === 'Sam');
    check('pending maps through', r.invites?.[1]?.status === 'pending' && r.invites?.[1]?.name === 'Maya');
  }
  {
    // unnamed rows can never appear in the list
    const rpc = fakeRpc(() => ok([
      { invite_id: 'id-9', partner_name: '', status: 'pending' },
      { invite_id: 'id-8', partner_name: null, status: 'pending' },
      { invite_id: 'id-7', partner_name: 'Maya', status: 'pending' },
    ]));
    const r = await getPartnerInvites(rpc);
    check(
      'unnamed rows excluded from list',
      r.status === 'ok' && r.invites?.length === 1 && r.invites[0].name === 'Maya',
      r,
    );
  }
  {
    const rpc = fakeRpc(() => err('x', '42883'));
    const r = await getPartnerInvites(rpc);
    check('missing function -> not_ready', r.status === 'not_ready', r);
  }

  console.log('revokePartnerInvite:');
  {
    let seenParams: Record<string, unknown> | undefined;
    const rpc = fakeRpc((_fn, params) => {
      seenParams = params;
      return ok(null);
    });
    const r = await revokePartnerInvite('invite-id-1', rpc);
    check('ok', r.status === 'ok', r);
    check('revoke passes invite id', param(seenParams, 'p_invite_id') === 'invite-id-1', seenParams);
  }
  {
    const rpc = fakeRpc(() => err('no_partner_link'));
    const r = await revokePartnerInvite('gone', rpc);
    check('missing invite -> no_partner_link', r.status === 'no_partner_link', r);
  }

  console.log('getLinkedOwnerId:');
  {
    const rpc = fakeRpc(() => ok('owner-uuid-9'));
    const r = await getLinkedOwnerId(rpc);
    check('ok returns owner id', r.status === 'ok' && r.ownerId === 'owner-uuid-9', r);
  }

  console.log('role kv persistence:');
  {
    const kv = fakeKv();
    check('role starts null', getOnboardingRole(kv) === null);
    setOnboardingRole(kv, 'partner');
    check('role persists', getOnboardingRole(kv) === 'partner');
    check('role key is partner-scoped', kv.store[ONBOARDING_ROLE_KEY] === 'partner');
    clearOnboardingRole(kv);
    check('clear forgets the role', getOnboardingRole(kv) === null);
    check('linked starts false', !isPartnerLinked(kv));
    setPartnerLinked(kv);
    check('linked persists', isPartnerLinked(kv) && kv.store[PARTNER_LINKED_KEY] === '1');
    check('onboarding-done starts false', !isPartnerOnboardingDone(kv));
    setPartnerOnboardingDone(kv);
    check(
      'onboarding-done persists',
      isPartnerOnboardingDone(kv) && kv.store[PARTNER_ONBOARDING_DONE_KEY] === '1',
    );
  }

  console.log('constants:');
  check('MAX_PARTNERS is 5', MAX_PARTNERS === 5);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
