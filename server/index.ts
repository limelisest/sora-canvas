import { buildApp } from './app.js';

const port = Number(process.env.PORT || 3890);
const host = process.env.HOST || '127.0.0.1';

async function main() {
  const app = await buildApp({ logger: true });

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port, host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
