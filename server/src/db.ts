import postgres from "postgres";

export type Database = {
  sql: postgres.Sql | null;
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
};

export function createDb(databaseUrl: string | undefined): Database {
  if (!databaseUrl) {
    return {
      sql: null,
      async ping() {
        return false;
      },
      async close() {},
    };
  }

  const sql = postgres(databaseUrl, {
    max: 10,
    connect_timeout: 5,
    idle_timeout: 20,
  });

  return {
    sql,
    async ping() {
      try {
        await sql`select 1 as ok`;
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.error(`Database ping failed: ${message}`);
        return false;
      }
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
