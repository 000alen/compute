import { createTRPCClient as _createTRPCClient, httpSubscriptionLink, httpBatchLink, splitLink } from '@trpc/client';
import type { ComputeRouter } from './server.js';
import { EventSource } from "eventsource";

globalThis.EventSource = EventSource;

export function createTRPCClient(url: string) {
  const trpc = _createTRPCClient<ComputeRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: httpSubscriptionLink({ url: url }),
        false: httpBatchLink({ url: url }),
      }),
    ],
  });

  return trpc;
}
