import { Badge, Card, CardBody, CardHeader } from "@/ui";
import styles from "./TodoPanel.module.css";

export interface TodoPanelProps {
  title: string;
  /** What this panel will show once it's wired up. */
  description: string;
  /** What has to exist first (a schema, a router, a domain module...). */
  blockedBy?: string;
}

/**
 * A panel that honestly says "not implemented yet" instead of showing
 * placeholder/fake data. Used across the dev playground's still-skeleton
 * tools (host/player/display/game) — see AGENTS.md-adjacent playground
 * principle: no fake backend, ever, just a clear TODO.
 */
export function TodoPanel({ title, description, blockedBy }: TodoPanelProps) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        <div className={styles.body}>
          <div className={styles.statusRow}>
            <Badge variant="warning">Not implemented</Badge>
            <Badge variant="neutral">Waiting for backend</Badge>
          </div>
          <p className={styles.description}>{description}</p>
          {blockedBy && <p className={styles.blockedBy}>waiting on: {blockedBy}</p>}
        </div>
      </CardBody>
    </Card>
  );
}
