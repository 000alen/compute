import { createTRPCClient as _createTRPCClient, httpSubscriptionLink, httpBatchLink, splitLink } from '@trpc/client';
import type { ComputeRouter } from './server.js';
import { EventSource } from "eventsource";

export interface CreateTRPCClientOptions {
  apiUrl?: string;
  headers?: Record<string, string>
  | (() => Record<string, string>)
  | (() => Promise<Record<string, string>>);
}

if (typeof globalThis.EventSource === "undefined") {
  globalThis.EventSource = EventSource as any;
}

export function createTRPCClient(options: CreateTRPCClientOptions) {
  let { apiUrl, headers } = options;

  apiUrl ??= process.env.COMPUTE_API_URL;

  if (!apiUrl) {
    throw new Error("COMPUTE_API_URL is not set. Either pass it as an option or set the environment variable.");
  }

  const trpc = _createTRPCClient<ComputeRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: httpSubscriptionLink({
          url: apiUrl,
        }),
        false: httpBatchLink({
          url: apiUrl,
          headers
        }),
      }),
    ],
  });

  return trpc;
}
