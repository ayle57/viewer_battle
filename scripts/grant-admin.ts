/**
 * Promote (or demote) a user account to streamer/admin.
 *
 *   pnpm grant-admin <username>            # make <username> an admin
 *   pnpm grant-admin <username> --revoke   # take admin away
 *   pnpm grant-admin --list                # show current admins
 *
 * `User.isAdmin` is the flag `/host` (game hosting) and the Admin panel
 * gate on — see prisma/schema.prisma's own doc comment. There is no
 * in-app screen to set it (deliberately: it's an operator action, not a
 * feature a viewer can reach), so this script is how the first admin
 * account gets created on a fresh deployment:
 *
 *   1. the operator registers a normal account at /account
 *   2. someone with DB access runs `pnpm grant-admin <that username>`
 *
 * Reads DATABASE_URL from the environment the same way the app does
 * (prisma.config.ts loads .env via dotenv).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set (check your .env).");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes("--revoke");
  const list = args.includes("--list");
  const username = args.find((a) => !a.startsWith("--"));

  if (list) {
    const admins = await prisma.user.findMany({ where: { isAdmin: true }, select: { username: true, createdAt: true } });
    if (admins.length === 0) {
      console.log("No admin accounts yet. Register at /account, then run: pnpm grant-admin <username>");
    } else {
      console.log("Admin accounts:");
      for (const a of admins) console.log(`  - ${a.username}  (created ${a.createdAt.toISOString().slice(0, 10)})`);
    }
    return;
  }

  if (!username) {
    console.error("Usage: pnpm grant-admin <username> [--revoke]");
    console.error("       pnpm grant-admin --list");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`No account with username "${username}". Register it at /account first.`);
    process.exit(1);
  }

  const isAdmin = !revoke;
  if (user.isAdmin === isAdmin) {
    console.log(`"${username}" is already ${isAdmin ? "an admin" : "not an admin"} — nothing to do.`);
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { isAdmin } });
  console.log(`"${username}" is now ${isAdmin ? "an admin" : "a normal account"}.`);
  if (isAdmin) console.log("They can now open /host and the Content Studio / Admin panel while signed in.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
