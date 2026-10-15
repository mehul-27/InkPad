// Perf (Fix B): in-memory LRU cache for resolved local images.
//
// Re-renders of a document used to re-query and re-read every image from
// disk over IPC on every pass. This module keeps resolved image sources
// (data URLs, same representation the Rust command already delivers)
// keyed by absolute path, so repeated renders, document switches and
// mode switches hit memory instead of the disk.
//
// One shared Map across all Reader instances: Map iteration order is
// insertion order, so get() re-inserting on a hit (delete + set) and
// trimming from the front is a complete LRU with no extra bookkeeping.

const MAX_ENTRIES = 50;

const cache = new Map<string, string>();

/// Cached source for `abs` if present (also refreshes its recency).
export function cachedImage(abs: string): string | undefined {
  const hit = cache.get(abs);
  if (hit === undefined) return undefined;
  cache.delete(abs);
  cache.set(abs, hit);
  return hit;
}

const inflight = new Map<string, Promise<string | null>>();

/// Resolve `abs` to an object/data URL, collapsing concurrent requests for
/// the same path into one read (a re-render mid-load must not double the
/// IPC work). Failures are not cached: a later render retries the read.
export function loadImageFromDisk(
  abs: string,
  read: (path: string) => Promise<{ mime: string; data: string } | null>,
): Promise<string | null> {
  const hit = cachedImage(abs);
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = inflight.get(abs);
  if (pending) return pending;
  const promise = read(abs)
    .then((data) => {
      if (!data) return null;
      const url = `data:${data.mime};base64,${data.data}`;
      cache.set(abs, url);
      // evict the least recently used entry once over the budget
      while (cache.size > MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return url;
    })
    .finally(() => {
      inflight.delete(abs);
    });
  inflight.set(abs, promise);
  return promise;
}
