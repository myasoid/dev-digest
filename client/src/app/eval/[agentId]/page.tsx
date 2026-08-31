/* Route: /eval/[agentId] — Per-agent eval dashboard.
   Thin route entry — interactive data is in AgentEvalDashboard (client component).
   "use client" stays down at the leaf; this shell is intentionally server-only. */

import { AgentEvalDashboard } from "../_components/AgentEvalDashboard";

export default function AgentEvalPage() {
  return <AgentEvalDashboard />;
}
