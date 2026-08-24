/* hooks/blast.ts — React Query hook for the PR blast-radius map.
   Mirrors the `usePrReviews` pattern: GET /pulls/:id/blast → PrBlastMap. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { PrBlastMap } from "@devdigest/shared";

/** PR blast-radius map — changed symbols → callers → impacted endpoints and crons.
 *  Served by `GET /pulls/:id/blast`. Disabled until `prId` is known. */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<PrBlastMap>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}
