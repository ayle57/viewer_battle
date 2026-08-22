"use client";

import styles from "./RememberedNameHint.module.css";

/**
 * The visible half of the "remembered name" convenience
 * (lastDisplayName.ts) — the "compte provisoire" ask: nothing is stored
 * server-side, there's no password, but a join screen that shows YOUR
 * pseudo back to you with an explicit "not you? Log out" reads and
 * behaves like a tiny local account you can sign out of, instead of a
 * silent autofill.
 *
 * Only ever rendered while the field still holds the untouched prefill
 * (see each caller's own `displayName === remembered` guard) — the moment
 * someone edits the name themselves, this disappears on its own, same as
 * any ordinary "is this you?" confirmation.
 */
export function RememberedNameHint({ name, onLogout }: { name: string; onLogout: () => void }) {
  return (
    <p className={styles.hint}>
      Playing as <strong>{name}</strong> —{" "}
      <button type="button" className={styles.logout} onClick={onLogout}>
        not you? Log out
      </button>
    </p>
  );
}
