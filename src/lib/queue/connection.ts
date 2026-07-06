export type RedisConnectionOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
};

function parseRedisDb(pathname: string) {
  const db = Number(pathname.replace("/", ""));

  if (!Number.isInteger(db) || db < 0) {
    return undefined;
  }

  return db;
}

export function getRedisConnectionOptions(): RedisConnectionOptions {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(redisUrl);
  } catch {
    throw new Error("REDIS_URL invalida");
  }

  if (!["redis:", "rediss:"].includes(parsedUrl.protocol)) {
    throw new Error("REDIS_URL deve usar protocolo redis:// ou rediss://");
  }

  const port = parsedUrl.port ? Number(parsedUrl.port) : 6379;

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("REDIS_URL possui porta invalida");
  }

  const options: RedisConnectionOptions = {
    host: parsedUrl.hostname || "localhost",
    port,
    maxRetriesPerRequest: null
  };

  if (parsedUrl.username) {
    options.username = decodeURIComponent(parsedUrl.username);
  }

  if (parsedUrl.password) {
    options.password = decodeURIComponent(parsedUrl.password);
  }

  if (parsedUrl.pathname && parsedUrl.pathname !== "/") {
    const db = parseRedisDb(parsedUrl.pathname);

    if (typeof db === "number") {
      options.db = db;
    }
  }

  return options;
}
