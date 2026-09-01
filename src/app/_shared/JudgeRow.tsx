"use client";

import { Button } from "@/ui";
import styles from "./JudgeRow.module.css";

export interface JudgeRowProps {
  onCorrect: () => void;
  onIncorrect: () => void;
  correctLoading?: boolean;
  incorrectLoading?: boolean;
  disabled?: boolean;
}

/**
 * The one Host judging control this app shows — shared by Jeopardy
 * (HostBoardPanel) and Drawing (HostDrawingPanel) so a Host who's used
 * one already knows exactly where to click in the other: "✓ Correct"
 * always first and primary, "✕ Incorrect" always second and
 * secondary/neutral. Deliberately never `danger` for a plain wrong
 * answer — `danger` is reserved for genuinely destructive actions (End
 * game), not "the team didn't get it." A REAL, REPRODUCED inconsistency
 * this fixes: Drawing's own judge row used to put "✗ Wrong" FIRST,
 * styled `danger` (red), while Jeopardy's put "✓ Correct" first,
 * `secondary` for the miss — a Host switching between the two games had
 * to re-learn which side of the row did what.
 *
 * No label props on purpose — the whole point is that both games render
 * the literal same two labels, not two configurable-but-driftable ones.
 */
export function JudgeRow({ onCorrect, onIncorrect, correctLoading = false, incorrectLoading = false, disabled = false }: JudgeRowProps) {
  return (
    <div className={styles.judgeRow}>
      <Button size="lg" loading={correctLoading} disabled={disabled} onClick={onCorrect}>
        ✓ Correct
      </Button>
      <Button size="lg" variant="secondary" loading={incorrectLoading} disabled={disabled} onClick={onIncorrect}>
        ✕ Incorrect
      </Button>
    </div>
  );
}
