"use client";

import { useState } from "react";
import type { PointingSystemState } from "@/domain/game/pointingSystem";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay";
import { Button, Card, CardBody, ConfirmDialog, Input } from "@/ui";
import { readablePointingSystemError } from "./gameErrorMessages";
import styles from "./HostPointingPanel.module.css";

export interface HostPointingPanelProps {
  state: PointingSystemState;
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "Team A", TEAM_B: "Team B" };
const QUICK_AMOUNTS = [1, 5, 10, 25];

type PendingAction = "SET_NAME" | "SET_ROUND_LABEL" | "ADD_POINTS" | "NEXT_ROUND" | "END_GAME" | null;

/**
 * The Host's control surface for whatever's being played OUTSIDE this
 * app — Jackbox Party and friends (types.ts's own doc comment). Two
 * renamable things, same click-to-edit pattern for both (mirrors Content
 * Studio's own playlist rename-in-place): the WHOLE activity's `name`
 * up top, and the CURRENT round's own `label` right below it (defaults
 * to "Round 1"/"Round 2"/... until the Host types the real mini-game's
 * name in). The scoreboard shows the running TOTAL (what actually
 * decides the winner) plus a small "this round" sub-line so a point
 * that just landed reads against the round it happened in, not just a
 * number climbing forever with no shape. `amount` is local-only UI
 * state (never sent by itself — it's folded into whichever ADD_POINTS
 * the Host actually clicks), letting one shared control cover both
 * "give +1 each time" and "that round was worth 50."
 */
export function HostPointingPanel({ state, sendAction }: HostPointingPanelProps) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [endGameOpen, setEndGameOpen] = useState(false);
  const [amount, setAmount] = useState(1);
  const [nameDraft, setNameDraft] = useState(state.name);
  const [renaming, setRenaming] = useState(false);

  const currentRound = state.rounds[state.rounds.length - 1]!;
  const pastRounds = state.rounds.slice(0, -1);
  const [roundLabelDraft, setRoundLabelDraft] = useState(currentRound.label);
  const [renamingRound, setRenamingRound] = useState(false);

  async function act(kind: PendingAction, action: Record<string, unknown>) {
    setPending(kind);
    setError(null);
    const result = await sendAction(action);
    if (!result.ok && result.error) setError(result.error);
    setPending(null);
  }

  function commitName() {
    setRenaming(false);
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === state.name) {
      setNameDraft(state.name);
      return;
    }
    void act("SET_NAME", { type: "SET_NAME", name: trimmed });
  }

  function commitRoundLabel() {
    setRenamingRound(false);
    const trimmed = roundLabelDraft.trim();
    if (!trimmed || trimmed === currentRound.label) {
      setRoundLabelDraft(currentRound.label);
      return;
    }
    void act("SET_ROUND_LABEL", { type: "SET_ROUND_LABEL", label: trimmed });
  }

  function award(team: "TEAM_A" | "TEAM_B", sign: 1 | -1) {
    void act("ADD_POINTS", { type: "ADD_POINTS", team, delta: amount * sign });
  }

  const finished = state.status === "finished";

  return (
    <div className={styles.wrap}>
      <Card variant="raised">
        <CardBody>
          {renaming ? (
            <input
              className={styles.nameInput}
              value={nameDraft}
              autoFocus
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setNameDraft(state.name);
                  setRenaming(false);
                }
              }}
              aria-label="Game name"
            />
          ) : (
            <button
              type="button"
              className={styles.nameButton}
              onClick={() => {
                setNameDraft(state.name);
                setRenaming(true);
              }}
              disabled={finished}
              title="Click to rename"
            >
              {state.name}
              {!finished && <span className={styles.nameEditHint}>✎ rename</span>}
            </button>
          )}

          {!finished &&
            (renamingRound ? (
              <input
                className={styles.roundInput}
                value={roundLabelDraft}
                autoFocus
                onChange={(event) => setRoundLabelDraft(event.target.value)}
                onBlur={commitRoundLabel}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setRoundLabelDraft(currentRound.label);
                    setRenamingRound(false);
                  }
                }}
                aria-label="Round label"
              />
            ) : (
              <button
                type="button"
                className={styles.roundButton}
                onClick={() => {
                  setRoundLabelDraft(currentRound.label);
                  setRenamingRound(true);
                }}
                title="Click to rename this round"
              >
                {currentRound.label} <span className={styles.nameEditHint}>✎</span>
              </button>
            ))}

          <AnimatedScoreDisplay
            teamAName="Team A"
            teamAScore={state.scores.TEAM_A}
            teamBName="Team B"
            teamBScore={state.scores.TEAM_B}
            label={finished ? `Game over — ${state.winner === "TIE" ? "tie" : `${TEAM_LABEL[state.winner as "TEAM_A" | "TEAM_B"]} wins`}` : undefined}
          />

          {!finished && (
            <p className={styles.thisRoundLine}>
              This round: <span className={styles.scoreA}>{currentRound.scores.TEAM_A}</span> — <span className={styles.scoreB}>{currentRound.scores.TEAM_B}</span>
            </p>
          )}
        </CardBody>
      </Card>

      {error && <p className={styles.errorBanner}>{readablePointingSystemError(error.code, error.message)}</p>}

      {!finished && (
        <>
          <div className={styles.amountRow}>
            <span className={styles.amountLabel}>Points per tap</span>
            <div className={styles.amountChips}>
              {QUICK_AMOUNTS.map((quick) => (
                <button
                  key={quick}
                  type="button"
                  className={[styles.amountChip, amount === quick && styles.amountChipActive].filter(Boolean).join(" ")}
                  onClick={() => setAmount(quick)}
                >
                  {quick}
                </button>
              ))}
              <Input
                aria-label="Custom points per tap"
                type="number"
                value={String(amount)}
                onChange={(event) => {
                  const parsed = Math.trunc(Number(event.target.value));
                  setAmount(Number.isFinite(parsed) ? parsed : 0);
                }}
                className={styles.amountInput}
              />
            </div>
          </div>

          <div className={styles.teamGrid}>
            {(["TEAM_A", "TEAM_B"] as const).map((team) => (
              <div key={team} className={[styles.teamBlock, styles[team === "TEAM_A" ? "teamA" : "teamB"]].join(" ")}>
                <p className={styles.teamName}>{TEAM_LABEL[team]}</p>
                <div className={styles.teamButtons}>
                  <Button
                    size="lg"
                    variant="secondary"
                    disabled={pending !== null || amount === 0}
                    loading={pending === "ADD_POINTS"}
                    onClick={() => award(team, -1)}
                  >
                    − {amount || 0}
                  </Button>
                  <Button size="lg" disabled={pending !== null || amount === 0} loading={pending === "ADD_POINTS"} onClick={() => award(team, 1)}>
                    + {amount || 0}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <Button
            size="lg"
            fullWidth
            variant="secondary"
            disabled={pending !== null}
            loading={pending === "NEXT_ROUND"}
            onClick={() => void act("NEXT_ROUND", { type: "NEXT_ROUND" })}
          >
            Next round →
          </Button>
        </>
      )}

      {pastRounds.length > 0 && (
        <Card>
          <CardBody>
            <p className={styles.historyTitle}>Round history</p>
            <ul className={styles.historyList}>
              {pastRounds.map((round) => (
                <li key={round.id} className={styles.historyRow}>
                  <span className={styles.historyLabel}>{round.label}</span>
                  <span className={styles.historyScore}>
                    <span className={styles.scoreA}>{round.scores.TEAM_A}</span> — <span className={styles.scoreB}>{round.scores.TEAM_B}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {!finished && (
        <div className={styles.endGameRow}>
          <Button variant="danger" size="sm" disabled={pending !== null} onClick={() => setEndGameOpen(true)}>
            End game
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={endGameOpen}
        title="End this game now?"
        description="The current leader (by running total) wins — a tie if the scores are level. This can't be undone."
        confirmLabel="End game"
        danger
        confirming={pending === "END_GAME"}
        onCancel={() => setEndGameOpen(false)}
        onConfirm={() => {
          setEndGameOpen(false);
          void act("END_GAME", { type: "END_GAME" });
        }}
      />
    </div>
  );
}
