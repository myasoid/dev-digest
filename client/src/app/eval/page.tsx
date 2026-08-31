/* Route: /eval — All-agents eval index.
   Thin route entry — interactive data is in AllAgentsIndex (client component).
   "use client" stays down at the leaf; this shell is intentionally server-only. */

import { AllAgentsIndex } from "./_components/AllAgentsIndex";

export default function EvalIndexPage() {
  return <AllAgentsIndex />;
}
