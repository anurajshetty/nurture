/**
 * Privacy controls for Nurture (Epic 0.3).
 *
 * - `exportArchive()` builds a JSON archive of all local data and hands it
 *   to an injectable file writer. expo-file-system is NOT installed in this
 *   repo yet, so the default writer throws a descriptive error; call
 *   `setArchiveWriter()` once a writer exists (e.g. after
 *   `npx expo install expo-file-system`). The archive payload itself is
 *   fully implemented and available via `buildArchivePayload()`.
 * - `requestAccountDeletion()` deletes server rows then wipes the local DB.
 *   It executes immediately — the UI layer must confirm with the user first.
 * - Biometric lock is a SecureStore flag + expo-local-authentication.
 *
 * v1 ships with NO analytics SDK — no third-party tracking is added here.
 *
 * Media (Epic 2.3): photo/file bytes live in her private storage buckets.
 * The export manifest lists every cloud-backed attachment with a
 * short-lived signed download URL; attachments still device-only are
 * listed with a null URL. A future pass may zip bytes directly into the
 * archive.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { supabase, isConfigured } from '../lib/supabase';
import { clearAllLocalData } from '../lib/db';
import { listAllEventsIncludingDeleted, listPregnancies } from '../sync/store';
import { clearLocalMediaCache, getSignedMediaUrl, purgeAllUserMedia } from '../sync/media';
import { bucketForKind } from '../lib/types';
import { getPrefs } from '../notifications/prefs';
import type { EventAttachment, LocalEvent, Prefs, Pregnancy } from '../lib/types';

const BIOMETRIC_LOCK_KEY = 'nurture.biometric_lock';
const APP_VERSION = '1.0.0';

/**
 * expo-secure-store has no web implementation, so the biometric-lock flag
 * lives in localStorage on web. Same key, same '1'/'0' values.
 */
const flagStore =
  Platform.OS === 'web'
    ? {
        getItemAsync: async (key: string): Promise<string | null> => {
          try {
            return window.localStorage.getItem(key);
          } catch {
            return null;
          }
        },
        setItemAsync: async (key: string, value: string): Promise<void> => {
          try {
            window.localStorage.setItem(key, value);
          } catch {
              // Flag won't persist — acceptable on a test surface.
          }
        },
        deleteItemAsync: async (key: string): Promise<void> => {
          try {
            window.localStorage.removeItem(key);
          } catch {
            // Already gone — nothing to do.
          }
        },
      }
    : SecureStore;

/** Contents of a v1 export archive. */
export interface ArchivePayload {
  exportedAt: string; // ISO 8601
  app: string;
  /** All local events, including tombstones (deletedAt != null). */
  events: LocalEvent[];
  pregnancies: Pregnancy[];
  prefs: Prefs;
  /**
   * Epic 2.3: every cloud-backed attachment, with a short-lived signed
   * download URL minted at export time so she can fetch her originals.
   * Attachments still on this device only (upload 'pending'/'failed') are
   * listed with downloadUrl null — their bytes live in the app sandbox,
   * not in the archive.
   */
  media: Array<{
    eventId: string;
    attachmentId: string;
    name: string;
    mimeType?: string;
    bucket: 'photos' | 'files';
    storagePath: string | null;
    downloadUrl: string | null;
  }>;
  /** True when at least one attachment has cloud bytes in the manifest. */
  mediaIncluded: boolean;
}

/** Writes an archive file and returns its URI. Provided by the app layer. */
export interface ArchiveFileWriter {
  writeArchive: (filename: string, json: string) => Promise<string>;
}

let archiveWriter: ArchiveFileWriter | null = null;

/** Registers the file writer used by exportArchive(). Pass null to clear it. */
export function setArchiveWriter(writer: ArchiveFileWriter | null): void {
  archiveWriter = writer;
}

/** Assembles the full export payload from local storage. No file is written. */
export async function buildArchivePayload(): Promise<ArchivePayload> {
  const events = listAllEventsIncludingDeleted();
  const media: ArchivePayload['media'] = [];
  for (const event of events) {
    const raw = (event.data as Record<string, unknown>).attachments;
    if (!Array.isArray(raw)) continue;
    for (const r of raw) {
      if (typeof r !== 'object' || r === null) continue;
      const a = r as Partial<EventAttachment>;
      const bucket = bucketForKind(a.kind === 'photo' ? 'photo' : 'file');
      const storagePath = typeof a.storage_path === 'string' ? a.storage_path : null;
      media.push({
        eventId: event.id,
        attachmentId: typeof a.id === 'string' ? a.id : '',
        name: typeof a.name === 'string' ? a.name : 'attachment',
        mimeType: typeof a.mimeType === 'string' ? a.mimeType : undefined,
        bucket,
        storagePath,
        downloadUrl:
          a.upload === 'done' && storagePath
            ? await getSignedMediaUrl(bucket, storagePath)
            : null,
      });
    }
  }
  return {
    exportedAt: new Date().toISOString(),
    app: `nurture/${APP_VERSION}`,
    events,
    pregnancies: listPregnancies(),
    prefs: await getPrefs(),
    media,
    mediaIncluded: media.some((m) => m.downloadUrl != null),
  };
}

/**
 * Builds the JSON archive and writes it to a file, returning its URI.
 * Throws a descriptive error when no ArchiveFileWriter is registered.
 */
export async function exportArchive(): Promise<string> {
  if (!archiveWriter) {
    throw new Error(
      'Export is not available yet: no archive file writer is registered. ' +
        'Run `npx expo install expo-file-system`, then call setArchiveWriter() with an expo-file-system writer.',
    );
  }
  const payload = await buildArchivePayload();
  const date = payload.exportedAt.slice(0, 10);
  const filename = `nurture-export-${date}.json`;
  return archiveWriter.writeArchive(filename, JSON.stringify(payload, null, 2));
}

/**
 * Deletes the user's account data. When configured and signed in, removes all
 * server rows (events, pregnancies, notification prefs, profile), all
 * cloud-backed media in both storage buckets, and signs out; then always
 * wipes the local database and biometric flag. When unconfigured, clears
 * local data only. Caller must confirm with the user before invoking — this
 * function does not ask.
 */
export async function requestAccountDeletion(): Promise<void> {
  if (isConfigured && supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      // Epic 2.3: remove cloud-backed photo/file bytes first, so a later
      // row-deletion failure can't leave orphaned media behind.
      await purgeAllUserMedia(user.id);
      const deletions: Array<PromiseLike<{ error: { message: string } | null }>> = [
        supabase.from('events').delete().eq('user_id', user.id),
        supabase.from('pregnancies').delete().eq('user_id', user.id),
        supabase.from('notification_prefs').delete().eq('user_id', user.id),
        supabase.from('profiles').delete().eq('id', user.id),
      ];
      for (const deletion of deletions) {
        const { error } = await deletion;
        if (error) throw new Error(`Account deletion failed: ${error.message}`);
      }
    }
    await supabase.auth.signOut();
  }
  await clearLocalMediaCache();
  clearAllLocalData();
  try {
    await flagStore.deleteItemAsync(BIOMETRIC_LOCK_KEY);
  } catch {
    // Flag already absent — nothing to do.
  }
}

/** Returns true when the user has enabled the biometric app lock. */
export async function isBiometricLockEnabled(): Promise<boolean> {
  try {
    return (await flagStore.getItemAsync(BIOMETRIC_LOCK_KEY)) === '1';
  } catch {
    return false;
  }
}

/** Enables or disables the biometric app lock flag. */
export async function setBiometricLockEnabled(enabled: boolean): Promise<void> {
  await flagStore.setItemAsync(BIOMETRIC_LOCK_KEY, enabled ? '1' : '0');
}

/**
 * Prompts for biometrics (device fallback allowed). Returns true only when
 * the user authenticates; false when hardware/enrollment is missing, the
 * user cancels, or anything goes wrong. Never throws. Not available on
 * web — the lock simply stays off there.
 */
export async function unlockWithBiometrics(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const [hasHardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    if (!hasHardware || !enrolled) return false;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Nurture',
      cancelLabel: 'Cancel',
    });
    return result.success;
  } catch {
    return false;
  }
}
