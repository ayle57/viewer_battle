"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ChatMessage,
  ChatPanel,
  Dialog,
  Input,
  PlayerCard,
  ScoreDisplay,
  Tabs,
  TeamCard,
  type ChatMessageData,
} from "@/ui";
import styles from "./page.module.css";

// Fixed, not `new Date()`: this page is SSR'd, and a value that differs
// between the server render and the client hydration render (even by a
// few ms) triggers a hydration mismatch on anything derived from it — see
// ChatMessage's own formatTime comment for the other half of this.
const DEMO_TIME = new Date("2026-08-14T13:30:00");

const INITIAL_MESSAGES: ChatMessageData[] = [
  {
    id: "1",
    senderName: "Alex (Host)",
    role: "host",
    body: "Round 1 starts in 30 seconds!",
    createdAt: DEMO_TIME,
  },
  { id: "2", senderName: "Jamie", role: "team-a", body: "ready when you are", createdAt: DEMO_TIME },
  { id: "3", senderName: "Sam", role: "team-b", body: "let's go 🔥", createdAt: DEMO_TIME },
];

export default function ComponentsShowcasePage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [messages, setMessages] = useState(INITIAL_MESSAGES);

  return (
    <main className={styles.page}>
      <h1>UI Kit showcase</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Button</h2>
        <div className={styles.row}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </div>
        <div className={styles.row}>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
        <div className={styles.row}>
          <Button disabled>Disabled</Button>
          <Button loading>Loading</Button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Input</h2>
        <div className={styles.grid2}>
          <Input label="Display name" placeholder="e.g. Jamie" />
          <Input label="Session code" defaultValue="dev-session" />
          <Input label="Password" type="password" error="This field is required" />
          <Input label="Disabled" disabled defaultValue="locked" />
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Badge</h2>
        <div className={styles.row}>
          <Badge variant="neutral">Neutral</Badge>
          <Badge variant="success" dot>
            Connected
          </Badge>
          <Badge variant="warning">Waiting</Badge>
          <Badge variant="danger" dot>
            Disconnected
          </Badge>
          <Badge variant="host">Host</Badge>
          <Badge variant="teamA">Team A</Badge>
          <Badge variant="teamB">Team B</Badge>
          <Badge variant="display">Display</Badge>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Card</h2>
        <Card>
          <CardHeader title="Session #4821" subtitle="Created 2 minutes ago" />
          <CardBody>
            <p>Two teams of two, Mini Jeopardy queued as the first game.</p>
          </CardBody>
          <CardFooter>
            <Button size="sm">Open</Button>
            <Button size="sm" variant="ghost">
              Copy link
            </Button>
          </CardFooter>
        </Card>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Dialog</h2>
        <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="End session?">
          <p>This disconnects every player, host, and display currently in the room.</p>
          <div className={styles.row} style={{ marginTop: "1rem" }}>
            <Button variant="danger" onClick={() => setDialogOpen(false)}>
              End session
            </Button>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
          </div>
        </Dialog>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Tabs</h2>
        <Tabs
          items={[
            { value: "host", label: "Host", content: <p>Host control panel content.</p> },
            { value: "team-a", label: "Team A", content: <p>Team A private view.</p> },
            { value: "team-b", label: "Team B", content: <p>Team B private view.</p> },
          ]}
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>TeamCard / PlayerCard</h2>
        <div className={styles.grid2}>
          <TeamCard
            side="A"
            name="The Challengers"
            score={340}
            players={[
              { name: "Jamie Lee", connected: true },
              { name: "Priya Nair", connected: true },
            ]}
          />
          <TeamCard
            side="B"
            name="Night Owls"
            score={280}
            players={[
              { name: "Sam Okafor", connected: true },
              { name: "Rin Tanaka", connected: false },
            ]}
          />
        </div>
        <div className={styles.row}>
          <PlayerCard name="Connected Player" connected />
          <PlayerCard name="Disconnected Player" connected={false} />
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>ScoreDisplay</h2>
        <Card>
          <ScoreDisplay teamAName="The Challengers" teamAScore={340} teamBName="Night Owls" teamBScore={280} />
        </Card>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>ChatMessage</h2>
        <Card>
          <CardBody>
            <ChatMessage id="a" senderName="Alex" role="host" body="Welcome everyone!" createdAt={DEMO_TIME} />
            <ChatMessage id="b" senderName="Jamie" role="team-a" body="hi!" createdAt={DEMO_TIME} />
            <ChatMessage id="c" senderName="Sam" role="team-b" body="good luck" createdAt={DEMO_TIME} />
            <ChatMessage id="d" senderName="OBS Display" role="display" body="(read-only)" createdAt={DEMO_TIME} />
          </CardBody>
        </Card>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>ChatPanel</h2>
        <div className={styles.chatPanelBox}>
          <ChatPanel
            messages={messages}
            onSend={(body) =>
              setMessages((current) => [
                ...current,
                { id: crypto.randomUUID(), senderName: "You", role: "host", body, createdAt: new Date() },
              ])
            }
          />
        </div>
      </section>
    </main>
  );
}
