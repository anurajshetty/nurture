/**
 * Owner-side loved-by labels (mockup 34): given the visible event ids,
 * returns entry id -> partner names from get_entry_loves(). Refetches
 * whenever the id set changes. Empty (and never-throwing) when the
 * backend isn't configured.
 */

import { useEffect, useState } from 'react';
import { defaultRpc } from './inviteCodes';
import { getEntryLoves } from './partnerHome';

export function useLovedBy(eventIds: string[]): Record<string, string[]> {
  const [map, setMap] = useState<Record<string, string[]>>({});
  const key = [...new Set(eventIds)].sort().join(',');
  useEffect(() => {
    let cancelled = false;
    const ids = key === '' ? [] : key.split(',');
    if (ids.length === 0) {
      setMap({});
      return;
    }
    getEntryLoves(ids, defaultRpc()).then((m) => {
      if (!cancelled) setMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return map;
}
