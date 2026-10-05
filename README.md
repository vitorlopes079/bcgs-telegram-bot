# BC.GS Telegram Bot

## Running

Required environment variables:

- `BOT_TOKEN=<telegram-bot-token>`
- `DATABASE_URL=<postgresql-connection-url>`

Optional environment variables:

- `ADMIN_CHAT_ID=<telegram-chat-id>`
- `DIRECT_URL=<direct-postgresql-connection-url>` (migrations only)

Run locally with `npm run dev`. Build with `npm run build`, then start with `npm start`.

Build and run the Docker image:

```sh
docker build -t bcgs-telegram-bot .
docker run --env-file .env bcgs-telegram-bot
```

Only one instance may run at a time because the bot uses long polling and in-memory conversation state.
