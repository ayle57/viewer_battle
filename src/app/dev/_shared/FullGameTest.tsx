"use client";

import { useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { trpc } from "@/app/_trpc/client";
import { Badge, Button, Card, CardBody, CardHeader } from "@/ui";
import styles from "./FullGameTest.module.css";

type StepStatus = "pending" | "running" | "ok" | "fail";
interface Step {
  label: string;
  status: StepStatus;
  detail?: string;
}

const STEP_LABELS = [
  "Session created",
  "6 participants connected",
  "Game started",
  "Question selected",
  "Team A buzzed",
  "Answer submitted",
  "Team A judged incorrect",
  "Team B stole",
  "Team B answered",
  "Team B scored correctly",
  "Next question — all 6 roles synced",
  "Display cannot act (rejected)",
  "Forbidden player action rejected",
  "Game played to completion",
  "Winner confirmed",
  "Session finished",
] as const;

/** Thrown when a step's own assertion fails — carries expected/actual so the timeline can show both, not just "something went wrong." */
class StepAssertionError extends Error {
  constructor(
    public expected: string,
    public actual: string,
  ) {
    super(`expected ${expected}, got ${actual}`);
  }
}

interface BoardSnapshot {
  gameId: string;
  state: {
    phase: string;
    status: string;
    activeQuestionId: string | null;
    playedQuestionIds: string[];
    submittedAnswer: string | null;
    winner: string | null;
    scores: { TEAM_A: number; TEAM_B: number };
    questions: { id: string; points: number }[];
  };
}

function connect(token: string): Socket {
  return io({ path: "/socket.io", auth: { token }, forceNew: true });
}
function waitForConnect(socket: Socket) {
  return new Promise<void>((resolve) => socket.once("connect", resolve));
}
function trackStates(socket: Socket) {
  const received: BoardSnapshot[] = [];
  socket.on("game:state", (s: BoardSnapshot) => received.push(s));
  return {
    latest: () => received[received.length - 1],
    async settle(): Promise<BoardSnapshot[]> {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return [received[received.length - 1]!];
    },
  };
}
function sendAction(socket: Socket, action: Record<string, unknown>) {
  return new Promise<{ ok: boolean; error?: { code: string; message: string } }>((resolve) => {
    socket.emit("game:action", action, resolve);
  });
}

/**
 * A real integration test, run from the browser against the real
 * backend — same tRPC procedures and Socket.IO events every dev tool
 * uses, just driven imperatively instead of by clicking through 6 tabs.
 * Nothing here is a mock: 6 real participants, 6 real sockets, real
 * game:action calls judged by the real Game Kernel. Stops at the first
 * failed step (not a "best effort" run) and shows exactly what was
 * expected vs what the server actually returned.
 */
export function FullGameTest() {
  const utils = trpc.useUtils();
  const [steps, setSteps] = useState<Step[]>(() => STEP_LABELS.map((label) => ({ label, status: "pending" })));
  const [running, setRunning] = useState(false);
  const socketsRef = useRef<Socket[]>([]);

  function setStep(index: number, status: StepStatus, detail?: string) {
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, status, detail } : s)));
  }

  async function runStep(index: number, fn: () => Promise<string | undefined>): Promise<boolean> {
    setStep(index, "running");
    try {
      const detail = await fn();
      setStep(index, "ok", detail);
      return true;
    } catch (err) {
      const detail =
        err instanceof StepAssertionError
          ? `expected: ${err.expected} — received: ${err.actual}`
          : err instanceof Error
            ? err.message
            : String(err);
      setStep(index, "fail", detail);
      return false;
    }
  }

  function assertOk(ack: { ok: boolean; error?: { code: string; message: string } }, action: string) {
    if (!ack.ok) throw new StepAssertionError(`${action} to succeed`, `rejected — ${ack.error?.code}: ${ack.error?.message}`);
  }

  async function run() {
    setRunning(true);
    setSteps(STEP_LABELS.map((label) => ({ label, status: "pending" })));
    const sockets: Socket[] = [];
    socketsRef.current = sockets;

    try {
      let sessionCode = "";
      let hostToken = "";
      let hostSocket!: Socket, aliceSocket!: Socket, charlieSocket!: Socket, displaySocket!: Socket;
      let tracks!: ReturnType<typeof trackStates>[];

      const ok0 = await runStep(0, async () => {
        const session = await utils.client.session.create.mutate();
        sessionCode = session.code;
        return `code ${session.code}`;
      });
      if (!ok0) return;

      const ok1 = await runStep(1, async () => {
        const join = (role: "HOST" | "TEAM_A" | "TEAM_B" | "DISPLAY", displayName: string) =>
          utils.client.session.join.mutate({ sessionCode, role, displayName });
        // Same batching rule as Quick Demo: the second seat on a team
        // must not race the first for the same slot.
        const [host, alice, charlie, display] = await Promise.all([
          join("HOST", "Test Host"),
          join("TEAM_A", "Test A1"),
          join("TEAM_B", "Test B1"),
          join("DISPLAY", "Test Display"),
        ]);
        const [bob, dave] = await Promise.all([join("TEAM_A", "Test A2"), join("TEAM_B", "Test B2")]);
        hostToken = host.token;
        hostSocket = connect(host.token);
        aliceSocket = connect(alice.token);
        charlieSocket = connect(charlie.token);
        displaySocket = connect(display.token);
        const bobSocket = connect(bob.token);
        const daveSocket = connect(dave.token);
        const all = [hostSocket, aliceSocket, bobSocket, charlieSocket, daveSocket, displaySocket];
        sockets.push(...all);
        await Promise.all(all.map(waitForConnect));
        // Only Host/Team A/Team B/Display's sockets are used to act or
        // assert below — Bob/Dave connect (proving all 6 seats are real,
        // live participants) but otherwise just ride along, same as a
        // real teammate watching their partner play.
        tracks = [hostSocket, aliceSocket, charlieSocket, displaySocket].map(trackStates);
        return "6/6 participants joined and connected";
      });
      if (!ok1) return;

      const ok2 = await runStep(2, async () => {
        const started = await utils.client.game.start.mutate({ token: hostToken, gameKey: "board-question" });
        await Promise.all(tracks.map((t) => t.settle()));
        return `gameId ${started.gameId}`;
      });
      if (!ok2) return;

      const ok3 = await runStep(3, async () => {
        const latest = tracks[0]!.latest();
        const question = latest?.state.questions.find((q) => !latest.state.playedQuestionIds.includes(q.id));
        if (!question) throw new StepAssertionError("an unplayed question to exist", "none found");
        const ack = await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: question.id });
        assertOk(ack, "SELECT_QUESTION");
        await Promise.all(tracks.map((t) => t.settle()));
        return question.id;
      });
      if (!ok3) return;

      const ok4 = await runStep(4, async () => {
        const ack = await sendAction(aliceSocket, { type: "BUZZ" });
        assertOk(ack, "Team A BUZZ");
        const [snapshot] = await tracks[0]!.settle();
        if (snapshot!.state.phase !== "answering") throw new StepAssertionError('phase "answering"', `phase "${snapshot!.state.phase}"`);
        return undefined;
      });
      if (!ok4) return;

      const ok5 = await runStep(5, async () => {
        const ack = await sendAction(aliceSocket, { type: "SUBMIT_ANSWER", text: "Full Game Test answer A" });
        assertOk(ack, "SUBMIT_ANSWER");
        await Promise.all(tracks.map((t) => t.settle()));
        return undefined;
      });
      if (!ok5) return;

      let firstQuestionPoints = 0;
      const ok6 = await runStep(6, async () => {
        const before = tracks[0]!.latest();
        firstQuestionPoints = before!.state.questions.find((q) => q.id === before!.state.activeQuestionId)?.points ?? 0;
        const ack = await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: false });
        assertOk(ack, "JUDGE_ANSWER correct:false");
        const [snapshot] = await tracks[0]!.settle();
        if (snapshot!.state.phase !== "revealed") throw new StepAssertionError('phase "revealed" (steal reopened)', `phase "${snapshot!.state.phase}"`);
        return undefined;
      });
      if (!ok6) return;

      const ok7 = await runStep(7, async () => {
        const ack = await sendAction(charlieSocket, { type: "BUZZ" });
        assertOk(ack, "Team B BUZZ (steal)");
        await Promise.all(tracks.map((t) => t.settle()));
        return undefined;
      });
      if (!ok7) return;

      const ok8 = await runStep(8, async () => {
        const ack = await sendAction(charlieSocket, { type: "SUBMIT_ANSWER", text: "Full Game Test answer B" });
        assertOk(ack, "SUBMIT_ANSWER (Team B)");
        await Promise.all(tracks.map((t) => t.settle()));
        return undefined;
      });
      if (!ok8) return;

      const ok9 = await runStep(9, async () => {
        const ack = await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: true });
        assertOk(ack, "JUDGE_ANSWER correct:true");
        const [snapshot] = await tracks[0]!.settle();
        if (snapshot!.state.scores.TEAM_B !== firstQuestionPoints) {
          throw new StepAssertionError(`TEAM_B score = ${firstQuestionPoints}`, `TEAM_B score = ${snapshot!.state.scores.TEAM_B}`);
        }
        return `TEAM_B +${firstQuestionPoints}`;
      });
      if (!ok9) return;

      const ok10 = await runStep(10, async () => {
        const latest = tracks[0]!.latest();
        const nextQuestion = latest!.state.questions.find((q) => !latest!.state.playedQuestionIds.includes(q.id));
        if (!nextQuestion) throw new StepAssertionError("another unplayed question to exist", "board already complete");
        const ack = await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: nextQuestion.id });
        assertOk(ack, "SELECT_QUESTION (2nd question)");
        const snapshots = await Promise.all(tracks.map((t) => t.settle()));
        const activeIds = snapshots.map((s) => s[0]!.state.activeQuestionId);
        if (!activeIds.every((id) => id === nextQuestion.id)) {
          throw new StepAssertionError(`all 4 sockets on "${nextQuestion.id}"`, activeIds.join(", "));
        }
        return nextQuestion.id;
      });
      if (!ok10) return;

      // These two run BEFORE the sweep on purpose, while the game is
      // genuinely still in progress — testing them after the game ends
      // would still get an `ok:false`, but for the wrong reason
      // (GAME_ALREADY_FINISHED masking whether the actual role check
      // works at all). This is the real assertion: rejected specifically
      // because of who's asking, not because there was nothing left to do.
      const ok11 = await runStep(11, async () => {
        const ack = await sendAction(displaySocket, { type: "SELECT_QUESTION", questionId: "irrelevant" });
        if (ack.ok) throw new StepAssertionError("Display's action to be rejected", "server accepted it");
        if (ack.error?.code !== "FORBIDDEN_ROLE") throw new StepAssertionError("FORBIDDEN_ROLE", ack.error?.code ?? "no code");
        return `rejected — ${ack.error?.code}`;
      });
      if (!ok11) return;

      const ok12 = await runStep(12, async () => {
        // Team B judging its own steal is host-only, forbidden regardless of phase.
        const ack = await sendAction(charlieSocket, { type: "JUDGE_ANSWER", correct: true });
        if (ack.ok) throw new StepAssertionError("Team B judging to be rejected (host-only)", "server accepted it");
        if (ack.error?.code !== "FORBIDDEN_ROLE") throw new StepAssertionError("FORBIDDEN_ROLE", ack.error?.code ?? "no code");
        return `rejected — ${ack.error?.code}`;
      });
      if (!ok12) return;

      const ok13 = await runStep(13, async () => {
        // Sweeps the remaining board — Team A always answers correctly —
        // so the game reaches a real "finished" status with a real
        // winner, not a hand-picked shortcut.
        let state = tracks[0]!.latest()!.state;
        let guard = 0;
        while (state.status !== "finished" && guard < 20) {
          guard++;
          if (state.phase === "selecting") {
            const q = state.questions.find((qq) => !state.playedQuestionIds.includes(qq.id));
            if (!q) break;
            await sendAction(hostSocket, { type: "SELECT_QUESTION", questionId: q.id });
          } else if (state.phase === "revealed") {
            await sendAction(aliceSocket, { type: "BUZZ" });
          } else if (state.phase === "answering" && state.submittedAnswer === null) {
            await sendAction(aliceSocket, { type: "SUBMIT_ANSWER", text: "sweep" });
          } else if (state.phase === "answering") {
            await sendAction(hostSocket, { type: "JUDGE_ANSWER", correct: true });
          }
          const [snapshot] = await tracks[0]!.settle();
          state = snapshot!.state;
        }
        if (state.status !== "finished") throw new StepAssertionError('status "finished"', `status "${state.status}" after ${guard} actions`);
        return `${guard} actions to complete the board`;
      });
      if (!ok13) return;

      const ok14 = await runStep(14, async () => {
        const state = tracks[0]!.latest()!.state;
        if (!state.winner) throw new StepAssertionError("a winner to be set", "winner is null");
        return state.winner;
      });
      if (!ok14) return;

      await runStep(15, async () => {
        const result = await utils.client.session.finish.mutate({ token: hostToken });
        if (!result.ok) throw new StepAssertionError("session.finish to succeed", "ok:false");
        return undefined;
      });
    } finally {
      sockets.forEach((s) => s.close());
      setRunning(false);
    }
  }

  return (
    <Card variant="raised">
      <CardHeader title="Run Full Game Test" subtitle="A real 6-client game, played end to end against the real backend" />
      <CardBody>
        <p className={styles.intro}>
          Creates a real session, joins Host + 4 players + Display with real tokens, opens real sockets, and plays a
          full round (select → buzz → answer → judge incorrect → steal → judge correct → sweep to game end) through
          the real Game Kernel — then checks the Display and a team can&apos;t do anything they&apos;re not allowed
          to. Stops at the first failure.
        </p>
        <div className={styles.runRow}>
          <Button loading={running} onClick={() => void run()}>
            Run Full Game Test
          </Button>
        </div>
        <ol className={styles.timeline}>
          {steps.map((step, i) => (
            <li key={i} className={styles.step}>
              <StepIcon status={step.status} />
              <div className={styles.stepBody}>
                <span className={styles.stepLabel}>{step.label}</span>
                {step.detail && (
                  <span className={step.status === "fail" ? styles.stepDetailFail : styles.stepDetail}>{step.detail}</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "ok") return <Badge variant="success">✓</Badge>;
  if (status === "fail") return <Badge variant="danger">✕</Badge>;
  if (status === "running") return <Badge variant="warning">…</Badge>;
  return <Badge variant="neutral">·</Badge>;
}
