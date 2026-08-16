import { redirect } from "next/navigation";

/**
 * `/host/content/jeopardy` already IS the playlists list (see
 * AGENTS.md-equivalent product spec section 19 — this route existing at
 * all is "if it improves navigation," and a bookmarkable canonical alias
 * is the whole benefit without a second copy of the same UI to keep in
 * sync).
 */
export default function JeopardyPlaylistsIndex() {
  redirect("/host/content/jeopardy");
}
