"use client";

import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import styles from "./BoardGrid.module.css";

export interface BoardGridProps {
  state: BoardQuestionState;
  /** Only passed by the host page — its presence, plus the board being in the "selecting" phase, is what makes a cell clickable. Nobody else can click regardless of whether this prop is passed, since only the host page ever passes it. */
  onSelect?: (questionId: string) => void;
}

/**
 * The categories x point-value grid — kept here, not in src/ui, because
 * this exact shape (a board of pre-authored questions with point values)
 * is Mini Jeopardy's own structure, not something other game types share
 * (see AGENTS.md "Game Kernel contract" on why there's no generic board
 * abstraction). QuestionPrompt/BuzzButton (src/ui) are the pieces of this
 * screen that genuinely are reusable across games.
 */
export function BoardGrid({ state, onSelect }: BoardGridProps) {
  const questionsByCategory = new Map<string, typeof state.questions>();
  for (const category of state.categories) questionsByCategory.set(category.id, []);
  for (const question of state.questions) questionsByCategory.get(question.categoryId)?.push(question);

  return (
    <div className={styles.board} style={{ gridTemplateColumns: `repeat(${state.categories.length}, 1fr)` }}>
      {state.categories.map((category) => (
        <div key={category.id} className={styles.column}>
          <p className={styles.categoryHeader}>{category.name}</p>
          {(questionsByCategory.get(category.id) ?? []).map((question) => {
            const played = state.playedQuestionIds.includes(question.id);
            const isActive = question.id === state.activeQuestionId;
            const selectable = Boolean(onSelect) && !played && state.phase === "selecting";
            return (
              <button
                key={question.id}
                type="button"
                disabled={!selectable}
                aria-label={played ? `${category.name} ${question.points}, already played` : `${category.name} ${question.points}`}
                className={[
                  styles.cell,
                  selectable && styles.cellSelectable,
                  played && styles.cellPlayed,
                  isActive && styles.cellActive,
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelect?.(question.id)}
              >
                {played ? "✓" : question.points}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
