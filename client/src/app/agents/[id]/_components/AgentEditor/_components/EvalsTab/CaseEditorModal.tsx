/* CaseEditorModal — (c) case editor modal, two columns ~920px.
   Left: Name + Input tabs (Diff | PR meta).
   Right: Expected output JSON editor + last-run strip.
   Footer: Run on save toggle, Cancel, Run case, Save.

   Two Input tabs (Diff | PR meta) — not three. input_files is not populated
   by case creation so the Files tab is omitted (Design reconciliation §20c).
   caseEditor.preview key is left unused rather than inventing a surface. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, TextInput, Textarea, Tabs, Toggle, SelectInput } from "@devdigest/ui";
import type { EvalCase, EvalRunRecord } from "@devdigest/shared";
import { ExpectedOutputEditor } from "./ExpectedOutputEditor";

type InputTab = "diff" | "prMeta";

interface CaseEditorModalProps {
  /** Undefined = new case, defined = editing existing case. */
  editingCase?: EvalCase | null;
  lastRun?: EvalRunRecord | null;
  onClose: () => void;
  onSave: (patch: CaseEditorPatch) => void;
  onRunCase?: () => void;
  isSaving?: boolean;
  isRunning?: boolean;
}

export interface CaseEditorPatch {
  name: string;
  input_diff: string;
  input_meta: { title?: string; body?: string } | null;
  targets_json: string;
  unlisted: "ignore" | "forbid";
  run_on_save: boolean;
}

export function CaseEditorModal({
  editingCase,
  lastRun,
  onClose,
  onSave,
  onRunCase,
  isSaving,
  isRunning,
}: CaseEditorModalProps) {
  const t = useTranslations("eval");

  // ---- Form state ----
  const [name, setName] = React.useState(editingCase?.name ?? "");
  const [inputTab, setInputTab] = React.useState<InputTab>("diff");
  const [diff, setDiff] = React.useState(editingCase?.input_diff ?? "");
  const [prTitle, setPrTitle] = React.useState(
    (editingCase?.input_meta as { title?: string } | null)?.title ?? "",
  );
  const [prBody, setPrBody] = React.useState(
    (editingCase?.input_meta as { body?: string } | null)?.body ?? "",
  );
  const [targetsJson, setTargetsJson] = React.useState(
    editingCase?.targets != null
      ? JSON.stringify(editingCase.targets, null, 2)
      : "[]",
  );
  const [unlisted, setUnlisted] = React.useState<"ignore" | "forbid">(
    editingCase?.unlisted ?? "ignore",
  );
  const [runOnSave, setRunOnSave] = React.useState(false);

  const inputTabs = [
    { key: "diff", label: t("caseEditor.tabs.diff") },
    { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
  ];

  function handleSave() {
    onSave({
      name,
      input_diff: diff,
      input_meta: prTitle || prBody ? { title: prTitle, body: prBody } : null,
      targets_json: targetsJson,
      unlisted,
      run_on_save: runOnSave,
    });
  }

  const isNew = !editingCase;
  const modalTitle = isNew
    ? t("caseEditor.newCase")
    : t("caseEditor.caseTitle", { name: editingCase.name });

  return (
    <Modal
      width={920}
      title={modalTitle}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
          {/* Run on save toggle */}
          <label
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}
          >
            <Toggle on={runOnSave} onChange={setRunOnSave} size={16} />
            {t("evalsTab.runOnSave")}
          </label>
          <div style={{ flex: 1 }} />
          <Button kind="ghost" size="sm" onClick={onClose}>
            {t("evalsTab.cancel")}
          </Button>
          {!isNew && (
            <Button
              kind="secondary"
              size="sm"
              icon="Play"
              disabled={isRunning}
              loading={isRunning}
              onClick={onRunCase}
            >
              {isRunning ? t("caseEditor.running") : t("caseEditor.runCase")}
            </Button>
          )}
          <Button
            kind="primary"
            size="sm"
            disabled={!name.trim() || isSaving}
            loading={isSaving}
            onClick={handleSave}
          >
            {isSaving ? t("evalsTab.saving") : t("evalsTab.save")}
          </Button>
        </div>
      }
    >
      {/* Two-column layout */}
      <div style={{ display: "flex", gap: 24, minHeight: 420, padding: "0 0 4px" }}>
        {/* Left column: Name + Input tabs */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Name */}
          <div>
            <label
              style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}
            >
              {t("caseEditor.nameLabel")}
            </label>
            <TextInput
              value={name}
              onChange={setName}
              placeholder={t("caseEditor.namePlaceholder")}
            />
          </div>

          {/* Unlisted findings mode */}
          <div>
            <label
              style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}
            >
              {t("caseEditor.unlistedLabel")}
            </label>
            <SelectInput
              value={unlisted}
              onChange={(v) => setUnlisted(v as "ignore" | "forbid")}
              options={[
                { value: "ignore", label: t("caseEditor.unlistedIgnore") },
                { value: "forbid", label: t("caseEditor.unlistedForbid") },
              ]}
              mono={false}
            />
          </div>

          {/* Input tabs */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <label
              style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}
            >
              {t("caseEditor.inputLabel")}
            </label>
            <Tabs
              tabs={inputTabs}
              value={inputTab}
              onChange={(k) => setInputTab(k as InputTab)}
              pad="0"
            />
            <div style={{ marginTop: 12, flex: 1 }}>
              {inputTab === "diff" ? (
                <Textarea
                  value={diff}
                  onChange={setDiff}
                  placeholder={t("caseEditor.diffPlaceholder")}
                  rows={14}
                  mono
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label
                      style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}
                    >
                      {t("caseEditor.titleLabel")}
                    </label>
                    <TextInput
                      value={prTitle}
                      onChange={setPrTitle}
                      placeholder={t("caseEditor.titlePlaceholder")}
                    />
                  </div>
                  <div>
                    <label
                      style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}
                    >
                      {t("caseEditor.bodyLabel")}
                    </label>
                    <Textarea
                      value={prBody}
                      onChange={setPrBody}
                      placeholder={t("caseEditor.bodyPlaceholder")}
                      rows={10}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column: Expected output */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <ExpectedOutputEditor
            value={targetsJson}
            onChange={setTargetsJson}
            lastRun={lastRun}
          />
        </div>
      </div>
    </Modal>
  );
}
