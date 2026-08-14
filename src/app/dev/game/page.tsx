"use client";

import { Card, CardBody, CardHeader } from "@/ui";
import { TodoPanel } from "../_shared/TodoPanel";
import styles from "../_shared/skeletonPage.module.css";

export default function GamePage() {
  return (
    <main className={styles.page}>
      <h1>Game</h1>
      <p className={styles.hint}>
        Cockpit for testing Game Engines once they exist. <code>src/domain/game</code> (the Game Kernel) has not
        been built yet — there is deliberately no simulated engine here standing in for it. The panels below are the
        shape this page will take as soon as there is a real engine to plug in, not a working preview.
      </p>

      <Card>
        <CardHeader title="Game Kernel — not implemented yet" />
        <CardBody>
          <p>
            Once <code>src/domain/game</code> exists (pure functions, zero I/O — see AGENTS.md folder boundaries),
            this page will let you: pick a registered engine, see its current state, apply actions to it and see the
            result, watch the events it emits, reset it, and replay a saved action sequence. Every one of those
            operates purely on the domain layer — no direct DB/Socket access from this page, same as the real game
            handlers will use.
          </p>
        </CardBody>
      </Card>

      <div className={styles.grid}>
        <TodoPanel title="Engine selector" description="Pick which registered game engine to test." blockedBy="src/domain/game engine registry" />
        <TodoPanel title="Current state" description="The engine's current state, rendered as-is." blockedBy="src/domain/game" />
        <TodoPanel title="Available actions" description="Which actions are legal from the current state." blockedBy="src/domain/game" />
        <TodoPanel title="Apply an action" description="Send an action into the engine and see the resulting state." blockedBy="src/domain/game" />
        <TodoPanel title="Event log" description="Events the engine emitted, in order." blockedBy="src/domain/game" />
        <TodoPanel title="Reset" description="Reset the engine to its initial state." blockedBy="src/domain/game" />
        <TodoPanel
          title="Replay a sequence"
          description="Re-apply a saved list of actions from the start, to reproduce a bug."
          blockedBy="src/domain/game"
        />
      </div>
    </main>
  );
}
