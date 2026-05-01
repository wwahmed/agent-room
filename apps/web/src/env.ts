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
  // Clerk is optional in v1: when the key isn't set we render the app
  // without any auth wiring (anonymous-only). The pay-to-unlock flow
  // checks for ENV.clerkPublishableKey and falls back to a "sign in
  // unavailable" message if it's missing.
  clerkPublishableKey: (import.meta.env as Record<string, string | undefined>).VITE_CLERK_PUBLISHABLE_KEY ?? '',
  // Stripe Payment Link for the per-report $29 unlock. Test-mode URL
  // during KYC; swap to the live-mode URL after Stripe approves the
  // account. Falls back to a mailto: in the FreeTierFooter when not set.
  stripePaymentLink: (import.meta.env as Record<string, string | undefined>).VITE_STRIPE_PAYMENT_LINK ?? '',
};
