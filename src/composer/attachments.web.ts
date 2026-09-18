/**
 * Attachment picking for the composer — web implementation (Epic 2.1).
 *
 * Plain file inputs (the browser owns permission + the picker UI).
 * Object URLs are session-local: they back the pending chips and the
 * just-saved card, and are released when the composer unmounts.
 */

import * as Crypto from 'expo-crypto';
import type { PendingAttachment } from './attachments';

function pickViaInput(accept: string, multiple: boolean, capture?: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    if (capture) input.setAttribute('capture', capture);
    input.onchange = () => {
      resolve(input.files ? Array.from(input.files) : []);
    };
    // If she dismisses the dialog, onchange never fires — resolve on focus
    // return so the promise can't hang forever.
    const onFocus = () => {
      window.removeEventListener('focus', onFocus);
      setTimeout(() => resolve(input.files ? Array.from(input.files) : []), 300);
    };
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

function toAttachment(file: File): PendingAttachment {
  const kind: PendingAttachment['kind'] = file.type.startsWith('image/')
    ? 'photo'
    : file.type.startsWith('video/')
      ? 'video'
      : 'file';
  return {
    id: Crypto.randomUUID(),
    kind,
    uri: URL.createObjectURL(file),
    name: file.name || 'attachment',
    mimeType: file.type || undefined,
  };
}

/** Releases object URLs created by this module. */
export function revokeAttachmentUris(attachments: PendingAttachment[]): void {
  for (const a of attachments) {
    if (a.uri.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(a.uri);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

export async function pickFromCamera(): Promise<PendingAttachment[]> {
  const files = await pickViaInput('image/*', false, 'environment');
  return files.map(toAttachment);
}

export async function pickFromLibrary(opts?: { videosOnly?: boolean }): Promise<PendingAttachment[]> {
  const files = await pickViaInput(opts?.videosOnly ? 'video/*' : 'image/*,video/*', true);
  return files.map(toAttachment);
}

export async function pickDocument(): Promise<PendingAttachment[]> {
  const files = await pickViaInput('application/pdf,image/*,.pdf', true);
  return files.map(toAttachment);
}
