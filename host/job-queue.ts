export function createSerialJobQueue<T>(run: (job: T) => Promise<void>) {
  const jobs: T[] = [];
  let active = false;

  const drain = async () => {
    if (active) return;
    active = true;
    try {
      while (jobs.length) {
        const job = jobs.shift()!;
        try {
          await run(job);
        } catch {
          // The runner owns user-facing failure reporting. Keep later jobs alive.
        }
      }
    } finally {
      active = false;
    }
  };

  return {
    enqueue(job: T) {
      jobs.push(job);
      const position = jobs.length;
      void Promise.resolve().then(drain);
      return position;
    },
    get size() {
      return jobs.length;
    },
    get running() {
      return active;
    },
  };
}
