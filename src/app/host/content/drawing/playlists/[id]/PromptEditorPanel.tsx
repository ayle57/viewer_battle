"use client";

import { forwardRef, useEffect, useImperativeHandle, useState, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { popIn } from "@/app/_shared/motion/variants";
import { trpc } from "@/app/_trpc/client";
import { Badge, Button, Input } from "@/ui";
import { SaveStatus, type SaveState } from "../../../_shared/SaveStatus";
import styles from "./PromptEditorPanel.module.css";

export interface PromptEditorPanelPrompt {
  id: string;
  text: string | null;
  durationSeconds: number;
}

export interface PromptEditorPanelProps {
  token: string;
  playlistId: string;
  prompt: PromptEditorPanelPrompt;
  promptNumber: number;
  /** Whether the sidebar already has a prompt after this one — same "jump vs. create" decision as GeoGuessr's RoundEditorPanel's identical `hasNextRound` prop. */
  hasNextPrompt: boolean;
  onSaved: (mode: "stay" | "next") => void;
  onDuplicate: () => void;
  duplicating: boolean;
  onRequestDelete: () => void;
  /** Same "warn before discarding an edit" contract as GeoGuessr's RoundEditorPanel's identical prop — see that component's own doc comment. */
  onDirtyChange: (dirty: boolean) => void;
}

/** Same shape/reasoning as GeoGuessr's identical `RoundEditorPanelHandle` — see that type's own doc comment. */
export interface PromptEditorPanelHandle {
  save: (mode: "stay" | "next") => Promise<boolean>;
}

const MIN_DURATION_SECONDS = 5;
const MAX_DURATION_SECONDS = 300;

/**
 * The prompt editor's MAIN panel — the Drawing counterpart to
 * ../../geoguessr/playlists/[id]/RoundEditorPanel.tsx, dramatically
 * simpler: a Drawing prompt is just a word to draw plus a per-prompt
 * timer (the literal "set the timer per round" product requirement,
 * src/domain/game/drawing/engine.ts's `applyChooseDrawer` reads this
 * exact field at game-start-snapshot time) — no image/asset concerns at
 * all. `key={prompt.id}` at the call site (../page.tsx) resets this
 * panel's local buffer state on a prompt switch, same reasoning as
 * GeoGuessr's own panel.
 */
export const PromptEditorPanel = forwardRef<PromptEditorPanelHandle, PromptEditorPanelProps>(function PromptEditorPanel(
  { token, playlistId, prompt, promptNumber, hasNextPrompt, onSaved, onDuplicate, duplicating, onRequestDelete, onDirtyChange },
  ref,
) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const utils = trpc.useUtils();
  const updatePrompt = trpc.content.drawingPrompt.update.useMutation();

  const [text, setText] = useState(prompt.text ?? "");
  const [durationSeconds, setDurationSeconds] = useState(prompt.durationSeconds);
  const [pendingMode, setPendingMode] = useState<"stay" | "next" | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // What's ACTUALLY saved right now — same "compare against the last
  // successful save, not the `prompt` prop" reasoning as GeoGuessr's own
  // `savedSnapshot` (that component's own doc comment covers the exact
  // race this avoids).
  const [savedSnapshot, setSavedSnapshot] = useState({ text: prompt.text ?? "", durationSeconds: prompt.durationSeconds });
  const isDirty = text !== savedSnapshot.text || durationSeconds !== savedSnapshot.durationSeconds;

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), []); // eslint-disable-line react-hooks/exhaustive-deps -- deliberately only on unmount, see RoundEditorPanel's identical pattern

  const ready = Boolean(text.trim());

  function save(mode: "stay" | "next"): Promise<boolean> {
    setPendingMode(mode);
    setSaveState("saving");
    return new Promise((resolve) => {
      updatePrompt.mutate(
        { token, promptId: prompt.id, text: text.trim() || null, durationSeconds },
        {
          onSuccess: () => {
            void utils.content.drawingPlaylist.get.invalidate({ token, playlistId });
            setSavedSnapshot({ text, durationSeconds });
            setPendingMode(null);
            setSaveState("saved");
            onSaved(mode);
            resolve(true);
          },
          onError: () => {
            setPendingMode(null);
            setSaveState("error");
            resolve(false);
          },
        },
      );
    });
  }

  // See PromptEditorPanelHandle's own doc comment — deliberately no deps
  // array, same reasoning as GeoGuessr's identical `useImperativeHandle`.
  useImperativeHandle(ref, () => ({ save }));

  // Cmd/Ctrl+Enter -> Save & Next Prompt — same one shortcut GeoGuessr's
  // own panel offers, same reasoning (item 9's "don't build a huge
  // shortcut system").
  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save("next");
    }
  }

  return (
    <div className={styles.panel} onKeyDown={handlePanelKeyDown}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.promptEyebrow}>PROMPT {String(promptNumber).padStart(2, "0")}</p>
          <h2 className={styles.promptTitle}>{text.trim() || "Untitled prompt"}</h2>
        </div>
        <div className={styles.headerRight}>
          <SaveStatus state={saveState} />
          <motion.span key={ready ? "ready" : "not-ready"} initial="hidden" animate="show" variants={popIn(reduced)}>
            <Badge variant={ready ? "success" : "warning"} dot>
              {ready ? "✓ READY" : "⚠ NOT READY"}
            </Badge>
          </motion.span>
        </div>
      </div>

      <div className={[styles.readinessPanel, ready ? styles.readinessPanelOk : styles.readinessPanelWarn].join(" ")}>
        {ready ? (
          <p className={styles.readinessLine}>Everything is set for this prompt.</p>
        ) : (
          <>
            <p className={styles.readinessLine}>
              Missing: <strong>Word to draw</strong>
            </p>
            <p className={styles.nextStepLine}>
              <span className={styles.nextStepLabel}>NEXT STEP</span> Type the word or character to draw.
            </p>
          </>
        )}
      </div>

      <div className={styles.form}>
        <Input
          label="Word or character to draw"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="e.g. Caterpillar"
          // Same "land on whichever field needs attention" idea as
          // GeoGuessr's own panel (item 9) — simpler here since there's
          // only ever one field that could need it. Safe as a plain HTML
          // attribute (not a ref effect): this whole panel remounts via
          // `key={prompt.id}` at the call site, so autoFocus firing once
          // per mount is exactly the "once per prompt switch" behavior
          // wanted, without needing Input to forward a ref (it doesn't).
          autoFocus={!ready}
        />

        <Input
          type="number"
          label="Time to draw (seconds)"
          hint={`Between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS} seconds — 30s is a good default, more for harder prompts.`}
          min={MIN_DURATION_SECONDS}
          max={MAX_DURATION_SECONDS}
          step={5}
          value={durationSeconds}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) setDurationSeconds(Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, Math.round(value))));
          }}
        />

        {updatePrompt.isError && <p className={styles.errorBanner}>Couldn&apos;t save this prompt. Please try again.</p>}

        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <Button variant="ghost" size="sm" onClick={onRequestDelete}>
              Delete prompt
            </Button>
            <Button variant="ghost" size="sm" loading={duplicating} onClick={onDuplicate}>
              Duplicate
            </Button>
          </div>
          <div className={styles.footerRight}>
            <Button variant="secondary" loading={pendingMode === "stay"} disabled={updatePrompt.isPending && pendingMode !== "stay"} onClick={() => void save("stay")}>
              Save
            </Button>
            <div className={styles.saveNextGroup}>
              <Button loading={pendingMode === "next"} disabled={updatePrompt.isPending && pendingMode !== "next"} onClick={() => void save("next")}>
                Save & Next Prompt →
              </Button>
              {!hasNextPrompt && <span className={styles.saveNextHint}>Creates prompt {String(promptNumber + 1).padStart(2, "0")}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
