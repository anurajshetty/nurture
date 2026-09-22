/**
 * Global "Share new entries with partners" default — storage wiring.
 *
 * The default lives in the local SQLite kv store (authoritative for
 * entry creation, works offline) and is mirrored to the server's
 * user_share_settings best-effort via the set_share_default RPC.
 * Default is ON: new logs, kicks, appointments and activities are
 * shared unless she turns it off. Changing it affects new entries
 * only — existing entries are never rewritten.
 */

import { kvGet, kvSet } from '../lib/db';
import {
  SHARE_DEFAULT_KEY,
  newEntryVisibility,
  setShareNewEntriesDefault,
  type ShareKv,
  type ShareDefaultRemoteResult,
  getShareDefaultRemote,
} from './sharing';
import type { PartnerRpc } from './inviteCodes';
import type { Visibility } from '../lib/types';

function defaultRpc(): PartnerRpc | null {
  try {
    // Static require literal (Metro-safe).
    const mod = require('../lib/supabase') as { supabase?: PartnerRpc | null };
    return mod.supabase ?? null;
  } catch {
    return null;
  }
}

const localShareKv: ShareKv = {
  getItem: async (key: string) => {
    try {
      return kvGet(key);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    kvSet(key, value);
  },
};

/**
 * Synchronous read of the global default for render-time initial state
 * (ON when never set). Components re-read on focus/sheet-open to pick
 * up changes made elsewhere.
 */
export function readShareDefaultSync(): boolean {
  try {
    const raw = kvGet(SHARE_DEFAULT_KEY);
    if (raw === null || raw === undefined) return true;
    return raw === '1';
  } catch {
    return true;
  }
}

/**
 * Write the global default: local kv first (authoritative), server
 * mirror best-effort. When the local kv has never been set, seeds it
 * from the server copy first (multi-device convergence).
 */
export async function writeShareDefault(value: boolean): Promise<void> {
  await setShareNewEntriesDefault(localShareKv, value, defaultRpc());
}

/**
 * Seed the local default from the server when this device has never
 * stored one (first run on a second device). Never overwrites a local
 * value she already chose.
 */
export async function seedShareDefaultFromServer(): Promise<void> {
  try {
    if (kvGet(SHARE_DEFAULT_KEY) !== null) return;
  } catch {
    return;
  }
  const remote: ShareDefaultRemoteResult = await getShareDefaultRemote(defaultRpc());
  if (remote.status === 'ok') {
    try {
      kvSet(SHARE_DEFAULT_KEY, remote.value ? '1' : '0');
    } catch {
      /* best-effort */
    }
  }
}

/**
 * The visibility a new entry is created with — global default, resolved
 * at creation time. Auto-saved kicks and Activity events use this (no
 * save-time UI).
 */
export async function resolveNewEntryVisibility(): Promise<Visibility> {
  return newEntryVisibility(localShareKv);
}
