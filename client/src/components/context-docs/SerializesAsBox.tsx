/* SerializesAsBox — the "SERIALIZES AS" manifest preview (EC-19). Shows the
   REAL heading the engine renders (`## Project context`), the attached paths
   in injection order, and a caption stating each is injected in full inside
   an untrusted block. Deliberately NOT the true serialization (full bodies +
   `<untrusted>` delimiters would be unreadable at this size) and NEVER a
   heading the engine doesn't emit — see reviewer-core/src/prompt.ts:146. */
"use client";

import React from "react";
import type { useTranslations } from "next-intl";
import { s } from "./styles";

export function SerializesAsBox({
  t,
  paths,
}: {
  t: ReturnType<typeof useTranslations<"context">>;
  /** Attached paths, in INJECTION order (AC-40). */
  paths: string[];
}) {
  if (paths.length === 0) return null;
  return (
    <div style={s.serializesBox}>
      <div style={s.serializesHeading}>{t("attach.serializesAs")}</div>
      <p style={s.serializesHint}>{t("attach.serializesAsHint")}</p>
      <div className="mono" style={{ color: "var(--text-secondary)" }}>
        ## Project context
      </div>
      {paths.map((path) => (
        <div key={path} className="mono" style={s.serializesPath}>
          {path}
        </div>
      ))}
    </div>
  );
}
