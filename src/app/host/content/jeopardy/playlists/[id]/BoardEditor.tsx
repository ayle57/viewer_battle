"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { trpc } from "@/app/_trpc/client";
import { ConfirmDialog } from "@/ui";
import { popIn } from "@/app/_shared/motion/variants";
import { describeQuestionIssue, getQuestionIssues } from "@/domain/content";
import type { PlaylistDetailClient, PlaylistQuestionClient } from "./types";
import styles from "./BoardEditor.module.css";

/**
 * The board itself — categories as columns, questions as cells within
 * each, in position order (NOT aligned by matching value across
 * categories — see prisma/schema.prisma's PlaylistQuestion.value comment
 * on why values are freely editable per-cell rather than a hardcoded
 * 100/200/300/400 row axis). Reordering is a pair of ‹›/▲▼ buttons, not
 * drag-and-drop — deliberately, per product spec (no DnD complexity
 * needed for a handful of categories/questions); `layout` on each column/
 * cell gives the actual reflow a real FLIP animation once the reorder
 * mutation resolves, so it still reads as a natural move rather than a
 * hard cut.
 */
export function BoardEditor({
  token,
  detail,
  onSelectQuestion,
  onCreateQuestion,
}: {
  token: string;
  detail: PlaylistDetailClient;
  onSelectQuestion: (questionId: string) => void;
  onCreateQuestion: (categoryId: string) => void;
}) {
  const utils = trpc.useUtils();
  const invalidate = () => void utils.content.playlist.get.invalidate({ token, playlistId: detail.id });
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment

  const createCategory = trpc.content.category.create.useMutation({ onSuccess: invalidate });
  const renameCategory = trpc.content.category.rename.useMutation({ onSuccess: invalidate });
  const deleteCategory = trpc.content.category.delete.useMutation({ onSuccess: invalidate });
  const reorderCategories = trpc.content.category.reorder.useMutation({ onSuccess: invalidate });
  const reorderQuestions = trpc.content.question.reorder.useMutation({ onSuccess: invalidate });

  const [pendingDeleteCategoryId, setPendingDeleteCategoryId] = useState<string | null>(null);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  const categories = detail.categories;
  const categoryToDelete = categories.find((c) => c.id === pendingDeleteCategoryId) ?? null;

  // Shared by the form's `onSubmit` (Enter) and the input's own `onBlur`
  // (clicking away) — one real action, two ways to trigger it, same as
  // `CategoryNameField`'s rename input already commits on blur. Guarded
  // by `createCategory.isPending` so a fast Enter-then-tab-away (or any
  // other double-trigger) can't fire two creates for one typed name.
  function commitNewCategory() {
    const name = newCategoryName.trim();
    if (!name || createCategory.isPending) return;
    createCategory.mutate(
      { token, playlistId: detail.id, name },
      { onSuccess: () => setNewCategoryOpen(false), onSettled: () => setNewCategoryName("") },
    );
  }

  function moveCategory(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= categories.length) return;
    const ids = categories.map((c) => c.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorderCategories.mutate({ token, playlistId: detail.id, orderedCategoryIds: ids });
  }

  function moveQuestion(categoryId: string, index: number, direction: -1 | 1) {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;
    const target = index + direction;
    if (target < 0 || target >= category.questions.length) return;
    const ids = category.questions.map((q) => q.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorderQuestions.mutate({ token, categoryId, orderedQuestionIds: ids });
  }

  return (
    <div className={styles.board}>
      <AnimatePresence initial={false}>
        {categories.map((category, categoryIndex) => (
          <motion.div key={category.id} layout className={styles.column} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: reduced ? 0.1 : 0.25 }}>
            <div className={styles.categoryHeader}>
              <button
                type="button"
                className={styles.iconButton}
                disabled={categoryIndex === 0}
                onClick={() => moveCategory(categoryIndex, -1)}
                aria-label={`Move ${category.name} left`}
              >
                ‹
              </button>
              {/* A category with zero questions is a real readiness
                  problem now (src/domain/content/readiness.ts), not a
                  lighter form of ready — same ✓/⚠ vocabulary as
                  QuestionCell below, at the column level instead of the
                  cell level, so scanning the board top-to-bottom already
                  tells the Host exactly which columns still need work. */}
              {category.questions.length === 0 && (
                <span className={styles.categoryEmptyGlyph} aria-hidden="true" title="This category has no questions yet">
                  ⚠
                </span>
              )}
              <CategoryNameField
                name={category.name}
                onCommit={(name) => name !== category.name && renameCategory.mutate({ token, categoryId: category.id, name })}
              />
              <button
                type="button"
                className={styles.iconButton}
                disabled={categoryIndex === categories.length - 1}
                onClick={() => moveCategory(categoryIndex, 1)}
                aria-label={`Move ${category.name} right`}
              >
                ›
              </button>
              <button
                type="button"
                className={`${styles.iconButton} ${styles.deleteButton}`}
                onClick={() => setPendingDeleteCategoryId(category.id)}
                aria-label={`Delete ${category.name}`}
              >
                ×
              </button>
            </div>

            <AnimatePresence initial={false}>
              {category.questions.map((question, questionIndex) => (
                <motion.div
                  key={question.id}
                  layout
                  className={styles.cellRow}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, transition: { duration: reduced ? 0.1 : 0.18 } }}
                  transition={{ duration: reduced ? 0.1 : 0.2 }}
                >
                  <QuestionCell question={question} onSelect={() => onSelectQuestion(question.id)} />
                  <div className={styles.cellControls}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      disabled={questionIndex === 0}
                      onClick={() => moveQuestion(category.id, questionIndex, -1)}
                      aria-label="Move question up"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      disabled={questionIndex === category.questions.length - 1}
                      onClick={() => moveQuestion(category.id, questionIndex, 1)}
                      aria-label="Move question down"
                    >
                      ▼
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            <motion.button
              type="button"
              layout
              className={[styles.cell, styles.addQuestionCell, category.questions.length === 0 && styles.addQuestionCellUrgent]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onCreateQuestion(category.id)}
            >
              <span className={styles.addQuestionPlus} aria-hidden="true">
                +
              </span>
              Add question
            </motion.button>
          </motion.div>
        ))}
      </AnimatePresence>

      <div className={styles.addCategoryColumn}>
        {newCategoryOpen ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              commitNewCategory();
            }}
          >
            <input
              className={styles.categoryNameInput}
              autoFocus
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              // A real, reproduced bug (found via a real browser, not a
              // code read): clicking away used to just leave the typed
              // name sitting there un-submitted — worse than silently
              // discarding it, since the plain, chrome-less text still
              // LOOKED exactly like a real saved category header (no
              // border once blurred), while the DB genuinely had nothing.
              // Blurring with a real name now commits it — same mental
              // model as `CategoryNameField`'s own rename input just
              // above, which already commits on blur; only a genuinely
              // empty draft closes without saving.
              onBlur={() => (newCategoryName.trim() ? commitNewCategory() : setNewCategoryOpen(false))}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setNewCategoryName("");
                  setNewCategoryOpen(false);
                }
              }}
              placeholder="Category name"
            />
          </form>
        ) : (
          <motion.button
            type="button"
            className={styles.addCategoryButton}
            onClick={() => setNewCategoryOpen(true)}
            variants={popIn(reduced)}
            initial="hidden"
            animate="show"
          >
            + Add category
          </motion.button>
        )}
      </div>

      <ConfirmDialog
        open={categoryToDelete !== null}
        title={`Delete "${categoryToDelete?.name}"?`}
        description={
          categoryToDelete && categoryToDelete.questions.length > 0
            ? `This category still has ${categoryToDelete.questions.length} question${categoryToDelete.questions.length === 1 ? "" : "s"}. Deleting it removes them too.`
            : "This category is empty."
        }
        confirmLabel="Delete category"
        danger
        confirming={deleteCategory.isPending}
        onCancel={() => setPendingDeleteCategoryId(null)}
        onConfirm={() => {
          if (!categoryToDelete) return;
          // Closes ONLY on success — a server refusal (product brief
          // "Show Preparation" section 12) keeps the dialog open with the
          // real error showing below, instead of silently vanishing.
          deleteCategory.mutate({ token, categoryId: categoryToDelete.id }, { onSuccess: () => setPendingDeleteCategoryId(null) });
        }}
      >
        {deleteCategory.isError && <p className={styles.errorBanner}>{deleteCategory.error.message}</p>}
      </ConfirmDialog>
    </div>
  );
}

/**
 * One board cell — shows the state a Host needs to know AT A GLANCE
 * before going live (product brief "Show Preparation" section 1): a
 * value, the prompt, and a READY/INCOMPLETE glyph computed by the same
 * shared `getQuestionIssues` (src/domain/content/readiness.ts) the
 * backend uses for playlist-level readiness — never a silent "looks
 * filled in, must be fine" assumption. `title` carries the specific
 * reason(s) as a native tooltip, cheap and always accurate since it's
 * derived from the same data as the glyph itself.
 */
function QuestionCell({ question, onSelect }: { question: PlaylistQuestionClient; onSelect: () => void }) {
  const issues = getQuestionIssues(question);
  const complete = issues.length === 0;
  return (
    <button
      type="button"
      className={`${styles.cell} ${complete ? "" : styles.cellIncomplete}`}
      onClick={onSelect}
      title={complete ? "Ready" : issues.map(describeQuestionIssue).join(", ")}
    >
      <span className={styles.cellStatus} aria-hidden="true">
        {complete ? "✓" : "⚠"}
      </span>
      <span className={styles.cellValue}>${question.value}</span>
      <span className={styles.cellPrompt}>{question.prompt || <em>No question text yet</em>}</span>
    </button>
  );
}

function CategoryNameField({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const [value, setValue] = useState(name);
  // Render-phase reset (React's blessed "adjusting state when a prop
  // changes" pattern, not an effect+setState) — resets the local edit
  // buffer whenever the underlying name actually changes (e.g. another
  // client's rename lands via refetch), without clobbering it on every
  // unrelated re-render the way a naive `useState(name)` read would.
  const [prevName, setPrevName] = useState(name);
  if (name !== prevName) {
    setPrevName(name);
    setValue(name);
  }

  return (
    <input
      className={styles.categoryNameInput}
      value={value}
      // A real, reproduced bug (found via a real browser, not a code
      // read): the input has no `text-overflow` handling at all, so a
      // category name even slightly wider than the column (confirmed via
      // `scrollWidth > clientWidth`, not just a screenshot guess) got
      // silently clipped mid-word with zero affordance that anything was
      // cut — worse right next to the always-visible DISABLED ‹/› arrow
      // at a board edge, which visually fused with the clipped text into
      // something unreadable. `title` is the cheap, always-accurate
      // native-tooltip fallback for the full name (CSS below adds the
      // ellipsis itself).
      title={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        const trimmed = value.trim();
        if (!trimmed) {
          setValue(name);
          return;
        }
        onCommit(trimmed);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setValue(name);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
