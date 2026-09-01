"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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

const DEMO_TIME = new Date("2026-08-14T13:30:00");

const CHAT_SAMPLE: ChatMessageData[] = [
  { id: "m-1", senderName: "Alex", role: "host", body: "Round starts in 20 seconds.", createdAt: DEMO_TIME },
  { id: "m-2", senderName: "Jamie", role: "team-a", body: "Team A ready.", createdAt: DEMO_TIME },
  { id: "m-3", senderName: "Sam", role: "team-b", body: "Team B ready.", createdAt: DEMO_TIME },
  {
    id: "m-4",
    senderName: "System",
    role: "display",
    body: "Waiting for backend: game events are not wired yet.",
    createdAt: DEMO_TIME,
    system: true,
  },
];

interface TokenSpec {
  name: string;
  use: string;
}

const TOKEN_GROUPS: { title: string; tokens: TokenSpec[] }[] = [
  {
    title: "Brand",
    tokens: [
      { name: "--vb-primary", use: "Primary actions" },
      { name: "--vb-primary-hover", use: "Primary hover" },
      { name: "--vb-accent", use: "Accent actions" },
      { name: "--vb-accent-hover", use: "Accent hover" },
    ],
  },
  {
    title: "Neutral",
    tokens: [
      { name: "--vb-bg", use: "Page background" },
      { name: "--vb-surface", use: "Panels and cards" },
      { name: "--vb-surface-raised", use: "Raised surfaces" },
      { name: "--vb-border", use: "Borders and separators" },
      { name: "--vb-text", use: "Primary text" },
      { name: "--vb-text-muted", use: "Secondary text" },
    ],
  },
  {
    title: "Semantic & roles",
    tokens: [
      { name: "--vb-success", use: "Connected / success states" },
      { name: "--vb-warning", use: "Warning states" },
      { name: "--vb-danger", use: "Error / destructive states" },
      { name: "--vb-host", use: "Host identity badge" },
      { name: "--vb-team-a", use: "Team A identity" },
      { name: "--vb-team-b", use: "Team B identity" },
      { name: "--vb-display", use: "Display identity" },
    ],
  },
];

function TokenSwatch({ name, use }: TokenSpec) {
  const hexRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (hexRef.current) hexRef.current.textContent = value;
  }, [name]);

  return (
    <div className={styles.tokenSwatch}>
      <div className={styles.tokenColor} style={{ background: `var(${name})` }} />
      <div className={styles.tokenBody}>
        <p className={styles.tokenName}>{name}</p>
        <p className={styles.tokenHex} ref={hexRef}>
          …
        </p>
        <p className={styles.tokenUse}>{use}</p>
      </div>
    </div>
  );
}

function ShowcaseSection({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {subtitle && <p className={styles.sectionSubtitle}>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export default function ComponentsShowcasePage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [messages, setMessages] = useState(CHAT_SAMPLE);

  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <h1>UI Kit — Dev Showcase</h1>
        <p>
          Playground frontend-only pour le labo ViewerBattle. Tous les composants utilisent uniquement les tokens
          actuels. Aucun backend mocké ici.
        </p>
      </div>

      <ShowcaseSection
        title="Tokens & palette audit"
        subtitle="The logo palette, kept as-is. No colors added outside the existing tokens."
      >
        <div className={styles.noticeRow}>
          <Badge variant="success" dot>
            Token check complete
          </Badge>
          <Badge variant="neutral">No missing token blocking this showcase</Badge>
        </div>
        {TOKEN_GROUPS.map((group) => (
          <div key={group.title} className={styles.tokenGroup}>
            <h3 className={styles.tokenGroupTitle}>{group.title}</h3>
            <div className={styles.tokenGrid}>
              {group.tokens.map((token) => (
                <TokenSwatch key={token.name} {...token} />
              ))}
            </div>
          </div>
        ))}
      </ShowcaseSection>

      <ShowcaseSection title="Button" subtitle="Variants, sizes, states: normal, hover, disabled, loading.">
        <Card variant="subtle">
          <CardBody>
            <div className={styles.stack}>
              <p className={styles.inlineLabel}>Variants</p>
              <div className={styles.row}>
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Danger</Button>
              </div>
              <p className={styles.inlineLabel}>Sizes</p>
              <div className={styles.row}>
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
              </div>
              <p className={styles.inlineLabel}>States</p>
              <div className={styles.row}>
                <Button>Normal</Button>
                <Button disabled>Disabled</Button>
                <Button loading>Loading</Button>
                <Button variant="secondary">Hover: survoler</Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </ShowcaseSection>

      <ShowcaseSection title="Input" subtitle="Normal / disabled / error, plus the session- and chat-form sizes.">
        <div className={styles.grid2}>
          <Input label="Session code" placeholder="X7K2QP" hint="6 characters" size="sm" />
          <Input label="Display name" placeholder="Jamie" size="md" />
          <Input label="Host note" placeholder="Ready for round 2" size="lg" />
          <Input label="Join token" defaultValue="readonly-preview" disabled hint="Locked by backend identity" />
          <Input label="Role" defaultValue="TEAM_A" error="Role not available in this session" />
        </div>
      </ShowcaseSection>

      <ShowcaseSection title="Card + Badge" subtitle="Realistic status panels for the dev workspace.">
        <div className={styles.grid2}>
          <Card>
            <CardHeader
              title={
                <div className={styles.rowBetween}>
                  <span>Session DEV-A12</span>
                  <Badge variant="success" dot>
                    Active
                  </Badge>
                </div>
              }
              subtitle="Host + 3 connected participants"
            />
            <CardBody>
              <p className={styles.muted}>État réel attendu une fois les flux host/player/display branchés.</p>
            </CardBody>
            <CardFooter>
              <Button size="sm">Open</Button>
              <Button size="sm" variant="secondary">
                Copy link
              </Button>
            </CardFooter>
          </Card>
          <Card variant="subtle">
            <CardBody>
              <div className={styles.row}>
                <Badge variant="host">Host</Badge>
                <Badge variant="teamA">Team A</Badge>
                <Badge variant="teamB">Team B</Badge>
                <Badge variant="display">Display</Badge>
                <Badge variant="warning">Waiting backend</Badge>
                <Badge variant="danger" dot>
                  Error
                </Badge>
              </div>
            </CardBody>
          </Card>
        </div>
      </ShowcaseSection>

      <ShowcaseSection title="Dialog" subtitle="Open state with a destructive action + cancel.">
        <div className={styles.row}>
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
        </div>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Finish session?"
          description="This action disconnects all roles from the current session."
        >
          <p className={styles.muted}>No fake action: this is presentational only in showcase mode.</p>
          <div className={styles.rowTop}>
            <Button variant="danger" onClick={() => setDialogOpen(false)}>
              Finish
            </Button>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
          </div>
        </Dialog>
      </ShowcaseSection>

      <ShowcaseSection title="Tabs" subtitle="Role-based navigation with a disabled state.">
        <Card variant="subtle">
          <CardBody>
            <Tabs
              defaultValue="host"
              items={[
                { value: "host", label: "Host", content: <p className={styles.muted}>Host control panel section.</p> },
                {
                  value: "team-a",
                  label: "Team A",
                  content: <p className={styles.muted}>Private Team A panel section.</p>,
                },
                {
                  value: "display",
                  label: "Display",
                  content: <p className={styles.muted}>Public display overlay section.</p>,
                },
                { value: "game", label: "Game", content: <p className={styles.muted}>Waiting for backend.</p>, disabled: true },
              ]}
            />
          </CardBody>
        </Card>
      </ShowcaseSection>

      <ShowcaseSection title="ViewerBattle composites" subtitle="TeamCard, PlayerCard, ScoreDisplay, ChatMessage, ChatPanel.">
        <div className={styles.grid2}>
          <TeamCard
            side="A"
            name="The Challengers"
            subtitle="Buzz specialists"
            score={340}
            players={[
              { name: "Jamie Lee", connected: true, detail: "Captain" },
              { name: "Priya Nair", connected: true, detail: "Support" },
            ]}
          />
          <TeamCard
            side="B"
            name="Night Owls"
            subtitle="Late game push"
            score={280}
            players={[
              { name: "Sam Okafor", connected: true, detail: "Captain" },
              { name: "Rin Tanaka", connected: false, detail: "Reconnecting" },
            ]}
          />
        </div>

        <Card>
          <ScoreDisplay
            label="Round 3"
            teamAName="The Challengers"
            teamAScore={340}
            teamBName="Night Owls"
            teamBScore={280}
          />
        </Card>

        <Card>
          <CardBody>
            <div className={styles.stack}>
              <PlayerCard name="Connected Player" detail="TEAM_A" connected />
              <PlayerCard name="Disconnected Player" detail="TEAM_B" connected={false} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className={styles.stack}>
              {CHAT_SAMPLE.map((message) => (
                <ChatMessage key={message.id} {...message} />
              ))}
            </div>
          </CardBody>
        </Card>

        <div className={styles.chatPanelBox}>
          <ChatPanel
            title="Session DEV-A12 / Public channel"
            messages={messages}
            onSend={(body) =>
              setMessages((current) => [
                ...current,
                { id: crypto.randomUUID(), senderName: "You", role: "host", body, createdAt: new Date() },
              ])
            }
          />
        </div>

        <div className={styles.chatPanelBox}>
          <ChatPanel title="Display mode" messages={CHAT_SAMPLE} disabled emptyLabel="No public announcement yet." />
        </div>
      </ShowcaseSection>
    </main>
  );
}
