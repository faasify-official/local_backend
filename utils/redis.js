/**
 * Redis helper for local Express and Lambda (@vendia/serverless-express).
 * - Reuses a single client across warm invocations to avoid reconnect churn in Lambda.
 * - Supports AWS ElastiCache TLS/password via environment variables while still defaulting to local Redis.
 * - Uses a backoff reconnect strategy so transient failures do not spam connection attempts.
 */
const { createClient } = require("redis");

const REDIS_HOST = process.env.REDIS_HOST || process.env.REDIS_ENDPOINT || "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_DB = parseInt(process.env.REDIS_DB || "0", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const USE_TLS =
  (process.env.REDIS_USE_TLS || process.env.REDIS_TLS || "").toLowerCase() === "true";
const REJECT_UNAUTHORIZED =
  (process.env.REDIS_TLS_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false";
const RECONNECT_BASE_MS = parseInt(process.env.REDIS_RECONNECT_BASE_MS || "100", 10);

let redisClient;
let connectPromise;

// Build the client once per container so Lambda warm starts reuse the socket.
const buildRedisClient = () => {
  const socketConfig = {
    host: REDIS_HOST,
    port: REDIS_PORT,
    reconnectStrategy: (retries) => Math.min(retries * 50 + RECONNECT_BASE_MS, 1000),
  };

  if (USE_TLS) {
    socketConfig.tls = true;
    socketConfig.rejectUnauthorized = REJECT_UNAUTHORIZED;
  }

  const client = createClient({
    socket: socketConfig,
    password: REDIS_PASSWORD,
    database: REDIS_DB,
  });

  client.on("error", (err) =>
    console.error("Redis client error (cache will be skipped):", err.message)
  );

  // If Redis closes, clear cached references so the next call can recreate it.
  client.on("end", () => {
    redisClient = null;
    connectPromise = null;
  });

  return client;
};

const getRedisClient = async () => {
  if (redisClient?.isOpen) return redisClient;
  if (connectPromise) return connectPromise;

  try {
    redisClient = buildRedisClient();
    connectPromise = redisClient
      .connect()
      .then(() => redisClient)
      .catch((err) => {
        console.error(
          "Redis connection failed, continuing without cache:",
          err.message
        );
        redisClient = null;
        connectPromise = null;
        return null;
      });

    return await connectPromise;
  } catch (err) {
    console.error(
      "Redis initialization failed, continuing without cache:",
      err.message
    );
    redisClient = null;
    connectPromise = null;
    return null;
  }
};

module.exports = { getRedisClient };
