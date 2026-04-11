function must(name: string): string {
  const val = (import.meta.env as Record<string, string | undefined>)[name];
  if (!val) throw new Error(`Missing env var: ${name}`);
  return val;
}

export const ENV = {
  upstash: {
    url: must('VITE_UPSTASH_REDIS_REST_URL'),
    token: must('VITE_UPSTASH_REDIS_REST_TOKEN'),
  },
  workerUrl: (import.meta.env as Record<string, string | undefined>).VITE_WORKER_URL ?? '',
};
