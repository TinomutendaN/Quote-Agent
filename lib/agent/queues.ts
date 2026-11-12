// Splits the inbox into one queue per supplier (plus one for files with no
// known supplier) and runs the queues side by side. Files inside a queue run
// one after another in received order, so a supplier's earlier quote always
// finishes before its later one (e.g. Swift Haul's 03 before 04) and
// check_duplicates sees it. Duplicates are only ever within one supplier, so
// different suppliers can safely run at the same time.
//
// Shared by the browser (Step 6) and scripts/agent-test.mjs: no imports, no
// server-only code, plain erasable TypeScript.

export type QueueFile = {
  id: number;
  supplier_id: number | null;
  file_name: string;
  received_at: string;
  is_held_back: boolean;
  is_upload: boolean;
  status: string;
};

export type FileQueue<F extends QueueFile = QueueFile> = {
  /** "supplier:3" or "unknown" */
  key: string;
  files: F[];
};

/** Most files processed at once across all queues. */
export const MAX_PARALLEL_FILES = 6;

/**
 * One queue per supplier, plus "unknown" for files with no supplier, each in
 * received order. Leaves out the held-back file and uploads. With
 * `onlyWaiting` (the default) files already done, needing review or being
 * worked on are left out too, so a stalled run carries on where it stopped.
 * Build the queues from a file list read AFTER POST /api/run: taking over a
 * stalled run puts stuck files back to waiting.
 */
export function buildInboxQueues<F extends QueueFile>(
  files: F[],
  { onlyWaiting = true }: { onlyWaiting?: boolean } = {},
): FileQueue<F>[] {
  const byKey = new Map<string, F[]>();
  const sorted = [...files].sort(
    (a, b) => Date.parse(a.received_at) - Date.parse(b.received_at) || a.id - b.id,
  );
  for (const file of sorted) {
    if (file.is_held_back || file.is_upload) continue;
    if (onlyWaiting && file.status !== "waiting") continue;
    const key = file.supplier_id === null ? "unknown" : `supplier:${file.supplier_id}`;
    const queue = byKey.get(key) ?? [];
    queue.push(file);
    byKey.set(key, queue);
  }
  // Queues whose first file arrived earliest start first.
  return [...byKey.entries()].map(([key, queueFiles]) => ({ key, files: queueFiles }));
}

/**
 * Runs every queue at the same time, one file at a time within each queue,
 * with at most `maxParallel` files in flight overall. `worker` must not throw;
 * return false to stop that queue (e.g. a file failed), or call
 * `shouldStop()` returning true to stop all queues after their current file
 * (used by "Pause agent").
 */
export async function runQueues<F extends QueueFile>(
  queues: FileQueue<F>[],
  worker: (file: F, queue: FileQueue<F>) => Promise<boolean | void>,
  {
    maxParallel = MAX_PARALLEL_FILES,
    shouldStop = () => false,
  }: { maxParallel?: number; shouldStop?: () => boolean } = {},
): Promise<void> {
  let inFlight = 0;
  const waiters: Array<() => void> = [];

  const acquire = async () => {
    while (inFlight >= maxParallel) await new Promise<void>((r) => waiters.push(r));
    inFlight++;
  };
  const release = () => {
    inFlight--;
    waiters.shift()?.();
  };

  await Promise.all(
    queues.map(async (queue) => {
      for (const file of queue.files) {
        if (shouldStop()) return;
        await acquire();
        let keepGoing: boolean | void;
        try {
          keepGoing = await worker(file, queue);
        } finally {
          release();
        }
        if (keepGoing === false) return;
      }
    }),
  );
}
