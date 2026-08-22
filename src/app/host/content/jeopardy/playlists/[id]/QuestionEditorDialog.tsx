"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { trpc } from "@/app/_trpc/client";
import { Button, Card, CardBody, ConfirmDialog, Dialog, Input, QuestionPrompt } from "@/ui";
import { EASE_OUT_EXPO } from "@/app/_shared/motion/variants";
import { getQuestionIssues } from "@/domain/content";
import { SaveStatus, type SaveState } from "../../../_shared/SaveStatus";
import type { PlaylistDetailClient } from "./types";
import styles from "./QuestionEditorDialog.module.css";

export type QuestionEditorMode = { type: "edit"; questionId: string } | { type: "create"; categoryId: string };

interface FieldsState {
  value: string;
  prompt: string;
  answer: string;
}

function nextSuggestedValue(existingValues: number[]): number {
  if (existingValues.length === 0) return 100;
  return Math.max(...existingValues) + 100;
}

/**
 * The Question Editor — a genuinely immersive three-pane experience on
 * desktop (a mini board map on the left, the editor fields in the
 * middle, LIVE PREVIEW on the right; stacked map-then-editor-then-preview
 * on narrow viewports), not a plain form in a box. The preview reuses
 * `QuestionPrompt` (src/ui/components) inside the identical `Card
 * variant="raised" > CardBody` wrapper every real board panel already
 * uses (HostBoardPanel/PlayerBoardPanel/DisplayBoardPanel,
 * src/app/_shared/boardQuestion) — the EXACT component and framing the
 * real reveal renders, not a lookalike copy, so "what I build here = what
 * players will see" is structurally true, not just a visual
 * approximation.
 *
 * Explicit Save, not fake autosave (see product spec section 11): every
 * mutation is a real, explicit server call with a visible Saving.../
 * Saved/error state (SaveStatus). Prev/Next, the mini nav, AND closing
 * the dialog (Escape, overlay click, the × button — all funnel through
 * the same `onClose` prop Dialog already calls) save a dirty edit first,
 * so nothing is silently lost.
 */
export function QuestionEditorDialog({
  token,
  detail,
  mode,
  onClose,
  onNavigate,
}: {
  token: string;
  detail: PlaylistDetailClient;
  mode: QuestionEditorMode;
  onClose: () => void;
  onNavigate: (mode: QuestionEditorMode) => void;
}) {
  const utils = trpc.useUtils();
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const invalidate = () => void utils.content.playlist.get.invalidate({ token, playlistId: detail.id });

  const flattened = useMemo(
    () => detail.categories.flatMap((category) => category.questions.map((question) => ({ category, question }))),
    [detail],
  );

  const activeCategory =
    mode.type === "edit"
      ? detail.categories.find((c) => c.questions.some((q) => q.id === mode.questionId))
      : detail.categories.find((c) => c.id === mode.categoryId);
  const activeQuestion = mode.type === "edit" ? activeCategory?.questions.find((q) => q.id === mode.questionId) : undefined;
  const activeIndex = mode.type === "edit" ? flattened.findIndex((f) => f.question.id === mode.questionId) : -1;

  const [fields, setFields] = useState<FieldsState>(() =>
    activeQuestion
      ? { value: String(activeQuestion.value), prompt: activeQuestion.prompt, answer: activeQuestion.answer }
      : { value: String(nextSuggestedValue(activeCategory?.questions.map((q) => q.value) ?? [])), prompt: "", answer: "" },
  );
  // Focus target for the fast-authoring loop (product brief "Show
  // Preparation" section 6: "après Save & add another, focus
  // automatiquement sur le champ principal de la prochaine question") —
  // the prompt textarea IS the main field a Host types into first for
  // each new question. A plain ref, not a controlled "should focus" state:
  // there's nothing to render differently, only an imperative focus() call
  // to make once the fields have been cleared for the next question.
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Set the instant a close/navigate attempt's auto-save-first (below)
  // fails validation or the mutation itself — a real, reproduced trap
  // (found via a real browser, not a code read): a Host who typed a
  // PARTIAL, invalid edit (e.g. a question with no answer yet) and then
  // tried to leave (×, Escape, overlay, Prev/Next) got stuck with only
  // the error showing — no affordance to actually leave short of either
  // finishing it validly or manually retyping every field back to empty/
  // its last-saved value themselves. Holds the exact action that was
  // blocked, so the discard link below can just run it directly, still
  // bypassing another save attempt. Cleared the instant the Host edits
  // any field again — that's them choosing to fix it instead.
  const [blockedAction, setBlockedAction] = useState<{ run: () => void; label: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [justDuplicated, setJustDuplicated] = useState(false);
  const [showAnswer, setShowAnswer] = useState(true);

  // Re-seed local fields whenever the target question/category actually
  // changes (Prev/Next, the mini nav, or a fresh "create" slot) — never
  // mid-edit of the SAME question, so a background refetch can't clobber
  // unsaved typing. Render-phase reset (React's blessed "adjusting state
  // when a prop changes" pattern), not an effect+setState.
  const identityKey = mode.type === "edit" ? mode.questionId : `create:${mode.categoryId}`;
  const [prevIdentityKey, setPrevIdentityKey] = useState(identityKey);
  if (identityKey !== prevIdentityKey) {
    setPrevIdentityKey(identityKey);
    setSaveState("idle");
    setErrorMessage(null);
    setBlockedAction(null);
    setJustDuplicated(false);
    if (activeQuestion) {
      setFields({ value: String(activeQuestion.value), prompt: activeQuestion.prompt, answer: activeQuestion.answer });
    } else {
      setFields({ value: String(nextSuggestedValue(activeCategory?.questions.map((q) => q.value) ?? [])), prompt: "", answer: "" });
    }
  }

  const createQuestion = trpc.content.question.create.useMutation();
  const updateQuestion = trpc.content.question.update.useMutation();
  const deleteQuestion = trpc.content.question.delete.useMutation();
  const duplicateQuestion = trpc.content.question.duplicate.useMutation();

  const isDirty = activeQuestion
    ? fields.value !== String(activeQuestion.value) || fields.prompt !== activeQuestion.prompt || fields.answer !== activeQuestion.answer
    : fields.prompt.trim() !== "" || fields.answer.trim() !== "";

  // The one place every field's onChange goes through — clears a pending
  // `blockedAction` (see its own doc comment above) the instant the Host
  // types again, since that's them choosing to fix the edit rather than
  // discard it. A stale "Discard and leave anyway" link sitting next to
  // fields the Host has since changed would be its own confusing,
  // inconsistent state.
  function updateField(patch: Partial<FieldsState>) {
    setFields((f) => ({ ...f, ...patch }));
    setBlockedAction(null);
  }

  async function save(): Promise<string | null> {
    const parsedValue = Number(fields.value);
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      setSaveState("error");
      setErrorMessage("Value must be a positive whole number.");
      return null;
    }
    if (!fields.prompt.trim() || !fields.answer.trim()) {
      setSaveState("error");
      setErrorMessage("Question and answer can't be empty.");
      return null;
    }

    setSaveState("saving");
    setErrorMessage(null);
    try {
      if (mode.type === "edit") {
        await updateQuestion.mutateAsync({ token, questionId: mode.questionId, value: parsedValue, prompt: fields.prompt, answer: fields.answer });
        invalidate();
        setSaveState("saved");
        return mode.questionId;
      }
      const created = await createQuestion.mutateAsync({
        token,
        categoryId: mode.categoryId,
        value: parsedValue,
        prompt: fields.prompt,
        answer: fields.answer,
      });
      invalidate();
      setSaveState("saved");
      return created.id;
    } catch (err) {
      setSaveState("error");
      setErrorMessage(err instanceof Error ? err.message : "Couldn't save — try again.");
      return null;
    }
  }

  /** Edit mode's only save action — updates in place, dialog stays open on the same question. (Create mode has no equivalent single-save button anymore; see handleSaveAndAddAnother's doc comment below for why.) */
  async function handleSaveClick() {
    await save();
  }

  /**
   * Create mode's ONLY save action — deliberately just one button, not
   * two. This used to sit alongside a separate "Create question" button
   * that saved-and-switched-to-a-review-of-that-one-question — a second,
   * visually-competing primary action that did almost the same thing for
   * a subtly different result, which is confusing at a glance, not fast.
   * A Host preparing 24+ questions has exactly one repeated motion: save
   * this one, get a fresh blank slot in the SAME category immediately, no
   * closing/reopening the dialog per question. "Done" (the footer's other
   * button) already covers "I'm finished for now" — it's the existing
   * save-if-dirty-then-close path every other exit from this dialog
   * (Escape, overlay click, ×) already uses, not a new concept. Resets
   * local field state directly rather than relying on the identityKey-
   * based reset above: navigating from `{type:"create",categoryId}` to
   * the exact same mode shape produces the SAME identityKey, so that
   * reset (correctly) wouldn't fire on its own here.
   */
  async function handleSaveAndAddAnother() {
    if (mode.type !== "create") return;
    const justSavedValue = Number(fields.value);
    const savedId = await save();
    if (!savedId) return;
    const existingValues = [...(activeCategory?.questions.map((q) => q.value) ?? []), justSavedValue];
    setFields({ value: String(nextSuggestedValue(existingValues)), prompt: "", answer: "" });
    setSaveState("idle");
    setErrorMessage(null);
    promptRef.current?.focus();
  }

  async function goToQuestion(questionId: string) {
    if (isDirty) {
      const savedId = await save();
      if (!savedId) {
        // Stay put, don't lose the edit — but leave a real way out
        // (below) instead of trapping the Host until they either finish
        // it validly or manually undo every field themselves.
        setBlockedAction({ run: () => onNavigate({ type: "edit", questionId }), label: "Discard changes and leave anyway" });
        return;
      }
    }
    onNavigate({ type: "edit", questionId });
  }

  async function goTo(targetIndex: number) {
    if (targetIndex < 0 || targetIndex >= flattened.length) return;
    await goToQuestion(flattened[targetIndex]!.question.id);
  }

  /** Same dirty-save-first shape as `goToQuestion` above, for jumping to an EMPTY category's first question from the mini map — the other real readiness problem (src/domain/content/readiness.ts) besides an incomplete existing question. */
  async function goToCreate(categoryId: string) {
    if (isDirty) {
      const savedId = await save();
      if (!savedId) {
        setBlockedAction({ run: () => onNavigate({ type: "create", categoryId }), label: "Discard changes and leave anyway" });
        return;
      }
    }
    onNavigate({ type: "create", categoryId });
  }

  /**
   * The one `onClose` Dialog ever calls — whether the Host clicked the ×,
   * clicked the overlay, or pressed Escape (Dialog's own Escape handler
   * just calls whatever `onClose` it was given; guarding here needs no
   * change to the shared primitive). A dirty, unsaved edit gets one
   * best-effort save first: "no silent loss" wins over "closing is
   * instant" — if the save itself fails, the dialog stays open with the
   * real error showing AND a "Discard and close anyway" way out
   * (`blockedAction` below), instead of trapping the Host.
   */
  async function handleClose() {
    if (isDirty) {
      const savedId = await save();
      if (!savedId) {
        setBlockedAction({ run: onClose, label: "Discard changes and close anyway" });
        return;
      }
    }
    onClose();
  }

  async function handleDelete() {
    if (mode.type !== "edit") return;
    try {
      await deleteQuestion.mutateAsync({ token, questionId: mode.questionId });
    } catch {
      // Stays open with the real error showing (deleteQuestion.isError,
      // rendered as ConfirmDialog's children below) instead of a
      // silently-vanishing dialog or an unhandled rejection — see
      // product brief "Show Preparation" section 12.
      return;
    }
    invalidate();
    setDeleteOpen(false);
    onClose();
  }

  async function handleDuplicate() {
    if (mode.type !== "edit") return;
    // A real, reproduced bug (found via a real browser, not a code
    // read): the button had no pending-state guard at all, and a real
    // double-click created TWO duplicates from one click — masked from a
    // naive "count the HTTP requests" check because tRPC's httpBatchLink
    // merges concurrent calls into a single request, so the SERVER still
    // received (and executed) both. `isPending` is checked here
    // synchronously (react-query flips it the instant `mutateAsync` is
    // called, before anything actually resolves) as the real guard; the
    // Button's own `loading` prop below is just the matching visual/
    // disabled state.
    if (duplicateQuestion.isPending) return;
    const copy = await duplicateQuestion.mutateAsync({ token, questionId: mode.questionId });
    invalidate();
    setJustDuplicated(true);
    // A short-lived, purely cosmetic acknowledgment (same pattern as
    // /host's SaveHostKey "Copied!" pulse) — not business logic, nothing
    // downstream depends on this timer, it only clears a UI pill.
    setTimeout(() => setJustDuplicated(false), 1600);
    onNavigate({ type: "edit", questionId: copy.id });
  }

  // Keyboard fast-path, product brief "Show Preparation" section 4:
  //   Cmd/Ctrl+Enter -> the footer's one primary action for the current
  //     mode: create mode's "save & add another" (the repeated bulk-entry
  //     motion), edit mode's plain "save" — from anywhere, including
  //     inside a field.
  //   ArrowLeft/ArrowRight -> Previous/Next, but ONLY when no field is
  //     focused — never hijacks cursor movement while typing.
  // A single document-level listener (matching how Dialog's own Escape
  // handling and ActionsMenu's outside-click already work in this app),
  // not a per-field handler — reads the LATEST callbacks/state through a
  // ref so the effect subscribes exactly once instead of thrashing the
  // listener on every keystroke.
  const latestRef = useRef({ handleSaveClick, handleSaveAndAddAnother, goTo, activeIndex, flattenedLength: flattened.length, modeType: mode.type });
  // Kept current after every render (not during it — mutating a ref
  // mid-render is disallowed) so the listener below always calls the
  // latest closures without needing to resubscribe on every keystroke.
  useEffect(() => {
    latestRef.current = { handleSaveClick, handleSaveAndAddAnother, goTo, activeIndex, flattenedLength: flattened.length, modeType: mode.type };
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isSaveChord = (event.metaKey || event.ctrlKey) && event.key === "Enter";
      if (isSaveChord) {
        event.preventDefault();
        if (latestRef.current.modeType === "create") {
          void latestRef.current.handleSaveAndAddAnother();
        } else {
          void latestRef.current.handleSaveClick();
        }
        return;
      }

      const target = document.activeElement;
      const isEditableFocused = target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (isEditableFocused) return;

      if (latestRef.current.modeType !== "edit") return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void latestRef.current.goTo(latestRef.current.activeIndex - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        void latestRef.current.goTo(latestRef.current.activeIndex + 1);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!activeCategory) return null;

  const title = mode.type === "create" ? "New question" : "Question";
  const previewPoints = Number(fields.value) > 0 ? Number(fields.value) : undefined;

  return (
    <Dialog open onClose={() => void handleClose()} title={title} description={activeCategory.name} size="xl">
      <div className={styles.layout}>
        <BoardMap
          categories={detail.categories}
          activeQuestionId={mode.type === "edit" ? mode.questionId : null}
          onSelect={(questionId) => void goToQuestion(questionId)}
          onSelectEmptyCategory={(categoryId) => void goToCreate(categoryId)}
        />

        <div className={styles.editorColumn}>
          <div className={styles.fieldRow}>
            <div className={styles.readOnlyField}>
              <span className={styles.readOnlyLabel}>Category</span>
              <span className={styles.readOnlyValue}>{activeCategory.name}</span>
            </div>
            <Input
              label="Value"
              type="number"
              min={1}
              value={fields.value}
              onChange={(event) => updateField({ value: event.target.value })}
            />
          </div>

          <label className={styles.field}>
            <span className={styles.readOnlyLabel}>Question</span>
            <textarea
              ref={promptRef}
              className={styles.textarea}
              value={fields.prompt}
              onChange={(event) => updateField({ prompt: event.target.value })}
              placeholder="What is the longest river in South America?"
              // Logical initial focus for the fast-entry case (product
              // brief "Show Preparation" section 6) — a fresh "create" slot
              // wants the Host typing the question immediately, no click
              // needed. Fires once per real mount only (this dialog never
              // remounts between "create another" in the same category —
              // see the identityKey reasoning above), so it never steals
              // focus back while editing an existing question.
              autoFocus={mode.type === "create"}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.readOnlyLabel}>Correct answer</span>
            <textarea
              className={styles.textarea}
              value={fields.answer}
              onChange={(event) => updateField({ answer: event.target.value })}
              placeholder="The Amazon"
            />
          </label>

          {errorMessage && (
            <p className={styles.errorBanner}>
              {errorMessage}
              {/* Only appears when a close/navigate attempt was actually
                  blocked by this exact error (not for a plain Save click
                  that failed) — the escape hatch for the trap described
                  on `blockedAction`'s own doc comment above. */}
              {blockedAction && (
                <button type="button" className={styles.discardLink} onClick={() => blockedAction.run()}>
                  {blockedAction.label}
                </button>
              )}
            </p>
          )}

          <div className={styles.footer}>
            <div className={styles.footerLeft}>
              {mode.type === "edit" && (
                <>
                  <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                    Delete
                  </Button>
                  <Button variant="ghost" size="sm" loading={duplicateQuestion.isPending} onClick={() => void handleDuplicate()}>
                    Duplicate
                  </Button>
                  {justDuplicated && (
                    <motion.span
                      className={styles.duplicatedPill}
                      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reduced ? 0.1 : 0.2, ease: EASE_OUT_EXPO }}
                    >
                      Duplicated ✓
                    </motion.span>
                  )}
                </>
              )}
            </div>
            <div className={styles.footerRight}>
              <SaveStatus state={saveState} />
              {/* Exactly one primary action per mode — create mode used to
                  show this alongside a second, visually-competing "Create
                  question" button that saved-and-switched-to-reviewing
                  that one question, which read as "which of these do I
                  actually want?" for something that should be instant.
                  "Done" covers "I'm finished for now" (the same save-if-
                  dirty-then-close every other exit from this dialog
                  already does — Escape, overlay click, ×), so create mode
                  needs nothing else beyond the one repeated bulk-entry
                  motion. */}
              {mode.type === "create" ? (
                <>
                  <Button variant="ghost" onClick={() => void handleClose()}>
                    Done
                  </Button>
                  <Button onClick={() => void handleSaveAndAddAnother()} loading={saveState === "saving"}>
                    Save &amp; add another
                  </Button>
                </>
              ) : (
                <Button onClick={() => void handleSaveClick()} loading={saveState === "saving"}>
                  Save
                </Button>
              )}
            </div>
          </div>

          {mode.type === "edit" && flattened.length > 1 && (
            <div className={styles.nav}>
              <Button variant="ghost" size="sm" disabled={activeIndex <= 0} onClick={() => void goTo(activeIndex - 1)}>
                ← Previous question
              </Button>
              <span className={styles.navCounter}>
                Question {activeIndex + 1} of {flattened.length}
              </span>
              <Button variant="ghost" size="sm" disabled={activeIndex === -1 || activeIndex >= flattened.length - 1} onClick={() => void goTo(activeIndex + 1)}>
                Next question →
              </Button>
            </div>
          )}
        </div>

        <div className={styles.previewColumn}>
          <div className={styles.previewHeaderRow}>
            <p className={styles.previewLabel}>Live Preview</p>
            <button type="button" className={styles.answerToggle} onClick={() => setShowAnswer((v) => !v)}>
              {showAnswer ? "Hide answer" : "Show answer"}
            </button>
          </div>
          <Card variant="raised" className={styles.previewFrame}>
            <CardBody>
              <QuestionPrompt
                category={activeCategory.name}
                points={previewPoints}
                prompt={fields.prompt}
                answer={showAnswer ? fields.answer || undefined : undefined}
                emptyLabel="What's the question?"
              />
            </CardBody>
          </Card>
          <p className={styles.previewHint}>
            This is exactly what the board shows once revealed — the answer stays editor-only, never sent to Player/Display.
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this question?"
        description="This permanently removes it from the board."
        confirmLabel="Delete"
        danger
        confirming={deleteQuestion.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
      >
        {deleteQuestion.isError && <p className={styles.errorBanner}>{deleteQuestion.error.message}</p>}
      </ConfirmDialog>
    </Dialog>
  );
}

/**
 * The mini board map (product brief "Show Preparation" section 4): every
 * category, every question, a READY/INCOMPLETE glyph per question (same
 * shared `getQuestionIssues` the Board Editor's cells and the backend's
 * readiness computation use — src/domain/content/readiness.ts), and the
 * currently-open question highlighted. Lets a Host parkour through a
 * 24-question board without ever closing this dialog. An empty category
 * (also a real readiness problem now, see readiness.ts) is itself a
 * button — clicking "No questions yet" jumps straight to a fresh
 * "create" slot in that category, same as clicking an existing cell
 * jumps to editing it.
 */
function BoardMap({
  categories,
  activeQuestionId,
  onSelect,
  onSelectEmptyCategory,
}: {
  categories: PlaylistDetailClient["categories"];
  activeQuestionId: string | null;
  onSelect: (questionId: string) => void;
  onSelectEmptyCategory: (categoryId: string) => void;
}) {
  return (
    <nav className={styles.boardMap} aria-label="Jump to a question">
      {categories.map((category) => (
        <div key={category.id} className={styles.boardMapGroup}>
          <p className={styles.boardMapCategory}>
            {category.questions.length === 0 && (
              <span className={styles.boardMapWarning} aria-hidden="true">
                ⚠{" "}
              </span>
            )}
            {category.name}
          </p>
          {category.questions.length === 0 ? (
            <button type="button" className={styles.boardMapEmpty} onClick={() => onSelectEmptyCategory(category.id)}>
              + Add first question
            </button>
          ) : (
            category.questions.map((question) => {
              const complete = getQuestionIssues(question).length === 0;
              const active = question.id === activeQuestionId;
              return (
                <button
                  key={question.id}
                  type="button"
                  className={[styles.boardMapRow, active && styles.boardMapRowActive].filter(Boolean).join(" ")}
                  onClick={() => onSelect(question.id)}
                  aria-current={active || undefined}
                >
                  <span>${question.value}</span>
                  <span className={complete ? styles.boardMapReady : styles.boardMapWarning} aria-hidden="true">
                    {complete ? "✓" : "⚠"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      ))}
    </nav>
  );
}
