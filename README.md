# ViewerBattle

ViewerBattle is an interactive **2v2 gameshow platform** designed for livestreams.

Two teams of two players compete across multiple games while a Host controls the show in real time.

## Features

- 2 teams of 2 players
- Multiple games in a single show
- Progressive scoring system
- Host control panel
- Player interface
- Real-time synchronization
- Private team chat
- OBS/browser display
- Session statistics
- Reusable UI and game components

Webcams are handled separately through **VDO.Ninja + OBS**.

## Games

The current specification includes:

1. Mini Jeopardy
2. Guess the Game via Steam Ratings
3. GeoGuessr-style game
4. Jackbox Party
5. Guess the Music
6. Drawing
7. Story Time
8. Top 5
9. Guess the Price

The system should remain flexible enough to add more games later.

## Tech Stack

- Next.js
- React
- TypeScript
- PostgreSQL
- pnpm
- Node.js

The project is a single Next.js application (not a monorepo) with a custom
server entrypoint attaching Socket.IO for realtime. See `AGENTS.md` for
working conventions and known constraints.

## Project Status

🚧 **In development**

The project is currently being designed and the core architecture is being implemented.

## License

Private project — all rights reserved.