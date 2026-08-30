/* AgentEditor — agent config (model + system prompt) and the skills attached to
   it. Evals/Stats/CI arrive with their own lessons. Tab state lives in ?tab=. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { SkillsTab } from "./_components/SkillsTab";
import { ContextTab } from "./_components/ContextTab";
import { EvalsTab } from "./_components/EvalsTab";
import { TABS } from "./constants";
import { s } from "./styles";

/** Lookup map replacing the nested ternary — at six tabs (Config · Skills ·
    Context · Evals · Stats · CI per the screenshot end-state) a fourth nesting
    level is the wrong shape. */
function TabBody({ agent, tab }: { agent: Agent; tab: string }) {
  switch (tab) {
    case "skills":
      return <SkillsTab agent={agent} />;
    case "context":
      return <ContextTab agent={agent} />;
    case "evals":
      return <EvalsTab agent={agent} />;
    default:
      return <ConfigTab agent={agent} />;
  }
}

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        <TabBody agent={agent} tab={tab} />
      </div>
    </div>
  );
}
