const token = process.env.TG_BOT_TOKEN;

if (!token) {
  console.error("TG_BOT_TOKEN is not set");
  process.exit(1);
}

console.info("labforge tg-bot: bot flow is implemented in Phase 2 (see CLAUDE.md)");
