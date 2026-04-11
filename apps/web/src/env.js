function must(name) {
    const val = import.meta.env[name];
    if (!val)
        throw new Error(`Missing env var: ${name}`);
    return val;
}
export const ENV = {
    upstash: {
        url: must('VITE_UPSTASH_REDIS_REST_URL'),
        token: must('VITE_UPSTASH_REDIS_REST_TOKEN'),
    },
    workerUrl: import.meta.env.VITE_WORKER_URL ?? '',
};
//# sourceMappingURL=env.js.map