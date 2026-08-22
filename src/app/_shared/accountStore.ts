"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface Account {
  token: string;
  username: string;
  /**
   * Cached from the server's own response at register/login/change-
   * username time (User.isAdmin — see that model's own doc comment,
   * prisma/schema.prisma) — what actually gates `/host` client-side
   * (host/page.tsx's own account gate). Purely a UX nicety, never the
   * real boundary: `session.create` itself always re-resolves this
   * account's token server-side (resolveAdminUserByToken) regardless of
   * whatever this cached value says, same "never trust the UI as the
   * boundary" posture as every other identity check in this app. A
   * value stored before this field existed simply reads as `undefined`
   * (falsy) after rehydration — the safe default, not a hole: it just
   * means re-logging in once to pick up a real `isAdmin` this store
   * hadn't cached yet.
   */
  isAdmin: boolean;
}

interface AccountState {
  account: Account | null;
  setAccount: (account: Account) => void;
  clearAccount: () => void;
}

/**
 * The real, persistent `User` account's own client-side identity — a
 * FOURTH store, deliberately separate from identityStore.ts (one live
 * game seat), contentIdentityStore.ts (the one operator's Content Studio
 * identity), and lastDisplayName.ts (a plain, silent localStorage
 * convenience, no server-side identity at all). See prisma/schema.prisma's
 * own User doc comment for why this is a genuinely separate, THIRD
 * identity system server-side — this store is its client-side mirror.
 *
 * `sessionStorage`, NOT `localStorage` — a REAL, REPORTED bug this
 * closes. The original reasoning here (a real account should be
 * visible/usable from every tab on this browser at once, so
 * `localStorage`'s cross-tab sharing was "exactly right, not a
 * tradeoff") was wrong in practice: this app is routinely used with
 * MANY tabs open at once, each one deliberately simulating a DIFFERENT
 * real participant (Team A1, Team A2, Team B, Host, Display — this is
 * the app's own standard way of testing/running a real show). With a
 * shared `localStorage` identity, logging into one account in ANY tab
 * silently overwrote what every OTHER open tab believed it was signed
 * in as — "sur mes différentes tabs je suis connecté au mauvais
 * compte." `sessionStorage` is exactly identityStore.ts's own,
 * already-correct answer to this identical problem ("a second tab must
 * be able to become a different participant") — a real account now
 * behaves the same way: still genuinely "remembered" across a reload or
 * reopening THIS tab (unlike a plain in-memory value), but two tabs no
 * longer fight over being the same person. The one real cost is that a
 * brand-new tab (or a full browser restart with session restore turned
 * off) starts signed out again — an honest tradeoff for a genuinely
 * low-stakes account (prisma/schema.prisma's own User doc comment),
 * not a regression on anything this app promised elsewhere.
 *
 * Pinned to globalThis for the same reason as every other store in this
 * app (see gameStore.ts/identityStore.ts) — Fast Refresh must not hand a
 * component a second, empty store while another part of the tree still
 * reads the old one.
 */
function createAccountStore() {
  return create<AccountState>()(
    persist(
      (set) => ({
        account: null,
        setAccount: (account) => set({ account }),
        clearAccount: () => set({ account: null }),
      }),
      {
        name: "viewerbattle-account",
        storage: createJSONStorage(() => sessionStorage),
      },
    ),
  );
}

const globalForAccountStore = globalThis as unknown as { viewerBattleAccountStore?: ReturnType<typeof createAccountStore> };
export const useAccountStore = globalForAccountStore.viewerBattleAccountStore ?? (globalForAccountStore.viewerBattleAccountStore = createAccountStore());
