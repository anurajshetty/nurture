/**
 * Per-entry partner sharing — contract tests (mockup 33 entry-sharing,
 * Anuraj approved Sept 21, 2026).
 *
 * Covers the sharing logic module (src/partner/sharing.ts) and the new
 * inviteCodes additions (pending code + sharing_enabled parsing, the
 * per-partner sharing RPC wrapper):
 *
 * - global "Share new entries with partners" default: ON when unset,
 *   persists across reads, survives kv failures
 * - new entries (including auto-saved kicks / Activity) follow the default
 * - isSharedVisibility / toggleVisibility / canToggleSharing mappings
 * - verbatim copy: handshake explainer, toggle labels, global-default sub
 * - set_partner_sharing RPC wrapper contract (params, statuses)
 * - set_event_shared / get_share_default RPC wrapper contracts
 *
 * Pure logic only: no network, no native modules — kv and RPC clients
 * are injected as fakes.
 *
 * Run with:
 *   npx tsc tests/partner_sharing.test.ts src/partner/sharing.ts src/partner/inviteCodes.ts src/lib/types.ts \
 *     --outDir /tmp/nurture-sharing-tests --module commonjs --target es2022 \
 *     --skipLibCheck --esModuleInterop
 *   node /tmp/nurture-sharing-tests/tests/partner_sharing.test.js
 */

import {
  HANDSHAKE_COPY,
  SHARE_DEFAULT_KEY,
  canToggleSharing,
  getShareDefaultRemote,
  getShareNewEntriesDefault,
  isSharedVisibility,
  newEntryVisibility,
  setEventSharedRemote,
  setShareNewEntriesDefault,
  shareDefaultSub,
  shareToggleLabels,
  toggleVisibility,
  type ShareKv,
} from '../src/partner/sharing';
import {
  getPartnerInvites,
  setPartnerSharing,
  type InviteKv,
  type PartnerInvite,
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

function fakeShareKv(initial: Record<string, string> = {}): ShareKv & {
  store: Record<string, string>;
} {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    getItem: async (k: string) => (k in store ? store[k] : null),
    setItem: async (k: string, v: string) => {
      store[k] = v;
    },
  };
}

function fakeInviteKv(initial: Record<string, string> = {}): InviteKv & {
  store: Record<string, string>;
} {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    get: (k: string) => (k in store ? store[k] : null),
    set: (k: string, v: string) => {
      store[k] = v;
    },
  };
}

interface RpcCall {
  fn: string;
  params?: Record<string, unknown>;
}
function fakeRpc(
  impl: (fn: string, params?: Record<string, unknown>) => {
    data: unknown;
    error: { code?: string; message: string } | null;
  },
): PartnerRpc & { calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  return {
    calls,
    rpc: async (fn: string, params?: Record<string, unknown>) => {
      calls.push({ fn, params });
      return impl(fn, params);
    },
  };
}

const okRpc = (data: unknown = null) =>
  fakeRpc(() => ({ data, error: null }));

async function main() {
  console.log('partner_sharing');

  // --- Verbatim copy -------------------------------------------------
  check(
    'handshake explainer is verbatim',
    HANDSHAKE_COPY ===
      'Sharing is a handshake: entries marked Shared are visible to partners whose sharing is on.',
  );
  {
    const l = shareToggleLabels(true);
    check(
      'toggle labels shared',
      l.status === 'Shared' && l.hint === 'Shared with your partner.',
    );
  }
  {
    const l = shareToggleLabels(false);
    check(
      'toggle labels private',
      l.status === 'Not shared' && l.hint === 'Only you can see this.',
    );
  }
  check(
    'global default ON sub is verbatim',
    shareDefaultSub(true) ===
      'On — new logs, kicks, appointments and activities are shared.',
  );
  check(
    'global default OFF sub is verbatim',
    shareDefaultSub(false) ===
      'Off — new entries stay private unless you share them.',
  );

  // --- Global default: ON unless she says otherwise ------------------
  {
    const kv = fakeShareKv();
    check('default is ON when never set', (await getShareNewEntriesDefault(kv)) === true);
    check(
      'new entries are shared by default',
      (await newEntryVisibility(kv)) === 'shared',
    );
  }
  {
    const kv = fakeShareKv();
    await setShareNewEntriesDefault(kv, false);
    check('OFF persists', (await getShareNewEntriesDefault(kv)) === false);
    check('raw kv stores 0', kv.store[SHARE_DEFAULT_KEY] === '0');
    check(
      'new entries are private when OFF',
      (await newEntryVisibility(kv)) === 'private',
    );
    await setShareNewEntriesDefault(kv, true);
    check('ON persists', (await getShareNewEntriesDefault(kv)) === true);
    check('raw kv stores 1', kv.store[SHARE_DEFAULT_KEY] === '1');
  }
  {
    const broken: ShareKv = {
      getItem: async () => {
        throw new Error('no storage');
      },
      setItem: async () => {
        throw new Error('no storage');
      },
    };
    check(
      'default falls back to ON when kv throws',
      (await getShareNewEntriesDefault(broken)) === true,
    );
    await setShareNewEntriesDefault(broken, false);
    check('set never rejects when kv throws', true);
  }
  {
    // Server mirror: set_share_default is called best-effort on change.
    const kv = fakeShareKv();
    const rpc = okRpc();
    await setShareNewEntriesDefault(kv, false, rpc);
    check(
      'set mirrors to set_share_default RPC',
      rpc.calls.length === 1 &&
        rpc.calls[0].fn === 'set_share_default' &&
        rpc.calls[0].params?.['p_default'] === false,
    );
  }
  {
    // Server mirror failure never breaks the local write.
    const kv = fakeShareKv();
    const rpc = fakeRpc(() => {
      throw new Error('offline');
    });
    await setShareNewEntriesDefault(kv, true, rpc);
    check(
      'local write survives RPC failure',
      (await getShareNewEntriesDefault(kv)) === true,
    );
  }

  // --- Visibility mappings -------------------------------------------
  check('shared counts as shared', isSharedVisibility('shared') === true);
  check('export counts as shared', isSharedVisibility('export') === true);
  check('private is not shared', isSharedVisibility('private') === false);
  check('null/undefined are not shared', isSharedVisibility(null) === false && isSharedVisibility(undefined) === false);
  check('toggle private -> shared', toggleVisibility('private') === 'shared');
  check('toggle shared -> private', toggleVisibility('shared') === 'private');
  check('toggle export -> private (export flow owns re-sharing)', toggleVisibility('export') === 'private');

  for (const t of ['note', 'kick_session', 'appointment', 'activity', 'report']) {
    check(`toggle shown for ${t}`, canToggleSharing(t) === true);
  }
  for (const t of ['mood', 'symptom', 'weight', 'photo', 'file', 'milestone', 'question']) {
    check(`no toggle for ${t}`, canToggleSharing(t) === false);
  }

  // --- Pending code + sharing_enabled parsing ------------------------
  {
    const rpc = fakeRpc(() => ({
      data: [
        {
          invite_id: 'a',
          partner_name: 'Maya',
          status: 'pending',
          created_at: '2026-09-21T00:00:00Z',
          code: 'KX7Q2M',
          sharing_enabled: true,
        },
        {
          invite_id: 'b',
          partner_name: 'Ravi',
          status: 'accepted',
          created_at: '2026-09-20T00:00:00Z',
          code: null,
          sharing_enabled: false,
        },
      ],
      error: null,
    }));
    const r = await getPartnerInvites(rpc);
    const byId = new Map((r.invites ?? []).map((i: PartnerInvite) => [i.id, i]));
    check(
      'pending invite exposes its code',
      byId.get('a')?.code === 'KX7Q2M',
    );
    check(
      'pending invite parses sharing_enabled',
      byId.get('a')?.sharingEnabled === true,
    );
    check(
      'accepted invite never exposes a code',
      byId.get('b')?.code === undefined,
    );
    check(
      'accepted invite parses sharing_enabled=false',
      byId.get('b')?.sharingEnabled === false,
    );
  }
  {
    // Legacy rows (old 4-column function) still parse: code undefined,
    // sharing defaults ON.
    const rpc = fakeRpc(() => ({
      data: [{ invite_id: 'c', partner_name: 'Sam', status: 'accepted', created_at: 'x' }],
      error: null,
    }));
    const r = await getPartnerInvites(rpc);
    check(
      'legacy row defaults sharingEnabled to true',
      r.invites?.[0]?.sharingEnabled === true,
    );
  }

  // --- set_partner_sharing wrapper ------------------------------------
  {
    const rpc = okRpc();
    const r = await setPartnerSharing('invite-1', false, rpc);
    check('setPartnerSharing ok', r.status === 'ok');
    check(
      'set_partner_sharing params are exact',
      rpc.calls.length === 1 &&
        rpc.calls[0].fn === 'set_partner_sharing' &&
        rpc.calls[0].params?.['p_invite_id'] === 'invite-1' &&
        rpc.calls[0].params?.['p_enabled'] === false,
    );
  }
  check(
    'setPartnerSharing without rpc is not_ready',
    (await setPartnerSharing('x', true, null)).status === 'not_ready',
  );
  {
    const rpc = fakeRpc(() => ({ data: null, error: { message: 'no_partner_link' } }));
    const r = await setPartnerSharing('gone', true, rpc);
    check('server no_partner_link surfaces as no_partner_link', r.status === 'no_partner_link');
  }

  // --- set_event_shared / get_share_default wrappers ------------------
  {
    const rpc = okRpc();
    const r = await setEventSharedRemote('evt-1', false, rpc);
    check('setEventSharedRemote ok', r.status === 'ok');
    check(
      'set_event_shared params are exact',
      rpc.calls.length === 1 &&
        rpc.calls[0].fn === 'set_event_shared' &&
        rpc.calls[0].params?.['p_event_id'] === 'evt-1' &&
        rpc.calls[0].params?.['p_shared'] === false,
    );
  }
  check(
    'setEventSharedRemote without rpc is not_ready',
    (await setEventSharedRemote('x', true, null)).status === 'not_ready',
  );
  {
    const rpc = fakeRpc(() => ({
      data: null,
      error: { message: 'function set_event_shared does not exist' },
    }));
    check(
      'missing function maps to not_configured',
      (await setEventSharedRemote('x', true, rpc)).status === 'not_configured',
    );
  }
  {
    const rpc = okRpc(true);
    const r = await getShareDefaultRemote(rpc);
    check('getShareDefaultRemote ok true', r.status === 'ok' && r.value === true);
  }
  {
    const rpc = okRpc(false);
    const r = await getShareDefaultRemote(rpc);
    check('getShareDefaultRemote ok false', r.status === 'ok' && r.value === false);
  }
  check(
    'getShareDefaultRemote without rpc is not_ready',
    (await getShareDefaultRemote(null)).status === 'not_ready',
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
