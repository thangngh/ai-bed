import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export default async function globalTeardown(): Promise<void> {
  const container = (globalThis as any).__PG_CONTAINER__ as
    | StartedPostgreSqlContainer
    | undefined;
  if (container) {
    await container.stop();
  }
}
