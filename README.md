# Redis Treasure Protocol (Dockerized)

A hands-on lab demonstrating four core Redis concepts — **rate limiting**, **TTL (time-to-live)**, **Pub/Sub (event-driven architecture)**, and **read-through caching** — fronted by a small Node.js/Express API, backed by MongoDB (persistent storage) and Redis (in-memory store).

## Architecture

- **app** — Node.js/Express server ([server.js](server.js)), listens on port `7000`
- **mongo** — MongoDB 7, stores clues and the final treasure flag
- **redis** — Redis 7, handles rate limiting, TTL keys, Pub/Sub, and caching

All three services run as separate containers on a private Docker Compose network, with `app` reaching the others via the hostnames `mongo` and `redis`.

On startup, the app:

1. Connects to Redis and Mongo
2. Wipes and reseeds Mongo with 3 clues + the final flag (`preloadMongo`)
3. Resets Redis (`flushAll`, sets `golden_key` to `"locked"`)
4. Subscribes to the `treasure_channel` Pub/Sub channel

## Requirements

- Docker
- Docker Compose

## Project Files

- [server.js](server.js) — Express API + Mongo/Redis integration
- [Dockerfile](Dockerfile) — builds the `app` image (Node 20-alpine)
- [docker-compose.yml](docker-compose.yml) — wires up `app`, `mongo`, `redis`
- [package.json](package.json) — dependencies (`express`, `mongoose`, `redis`)

## Step 0 — Ignite the Infrastructure

Build and start all three containers:

```bash
docker-compose up --build
```

In a new terminal tab, verify all three containers are running:

```bash
docker ps
```

You should see `app`, `mongo`, and `redis` containers, each `Up`.

Confirm the API is live:

```bash
curl http://localhost:7000/clue/1
```

Expected response:

```json
{"source":"MongoDB","message":"The gatekeeper watches your speed. Hit this endpoint more than 5 times in a minute to break through."}
```

> Note: the app listens on port **7000** (per `docker-compose.yml` and `server.js`), not 3000.

## Step 1 — Break the Gatekeeper (Rate Limiting)

`/clue/:step` is protected by a Redis-backed rate limiter ([server.js:65-80](server.js#L65-L80)): every request runs `INCR rate_limit:<your-ip>` in Redis, with a 60-second `EXPIRE` set on the first hit. Once the counter exceeds 5 within that window, the server returns `429`.

Hit the endpoint 6+ times within a minute:

```bash
for i in 1 2 3 4 5 6 7; do date; curl -s http://localhost:7000/clue/1; echo; echo "---"; done
```

After the 5th request, you'll get:

```json
{"concept":"Rate Limiting","message":"Redis tracked your requests using INCR and EXPIRE. You are moving too fast.","nextClue":"Create a Redis key 'temp_key' with value 'unlock' that expires in 10 seconds, then check /clue/2."}
```

## Step 2 — The Race Against Time (TTL)

`/clue/2` checks for a Redis key called `temp_key` before serving its content ([server.js:98-106](server.js#L98-L106)). If the key is missing or expired, it returns `403`.

Find your Redis container, then set a key that self-destructs after 10 seconds:

```bash
docker ps
docker exec -it redis-treasure-docker-redis-1 redis-cli
```

Inside `redis-cli`:

```bash
SETEX temp_key 10 unlock
```

Immediately (within 10 seconds) call the endpoint:

```bash
curl http://localhost:7000/clue/2
```

If you're fast enough:

```json
{"source":"MongoDB","message":"Redis is great at broadcasting. Use the command 'PUBLISH treasure_channel unlock' in your Redis client to trigger a state change in the system. Only then will the /treasure vault open."}
```

If you're too slow, `temp_key` will have expired and you'll get a `403 Access denied` response instead — that's the TTL lesson in action.

## Step 3 — The Ghost Signal (Pub/Sub)

The vault's `golden_key` state can only change via Redis Pub/Sub, not via any HTTP route ([server.js:53-62](server.js#L53-L62)). The app runs a dedicated `subscriber` Redis client listening on `treasure_channel`; receiving the message `"unlock"` flips `golden_key` to `"unlocked"`.

Inside `redis-cli`:

```bash
PUBLISH treasure_channel unlock
```

Expected: `(integer) 1` (one subscriber received it).

Check the app logs to confirm the trigger fired:

```bash
docker logs redis-treasure-docker-app-1 --tail 5
```

You should see:

```text
Event-Driven Architecture: Pub/Sub triggered the unlock!
```

This demonstrates asynchronous, event-driven communication — Redis told the Node.js app to change its internal state with no direct HTTP request involved.

## Step 4 — Claim the Treasure

With `golden_key` set to `"unlocked"`, request the final flag:

```bash
curl http://localhost:7000/treasure
```

Expected response:

```json
{"message":"Congratulations! You mastered Rate Limiting, TTL, Caching, and Pub/Sub.","treasure":"FLAG{redis_king_2026}"}
```

> **Implementation note:** `/treasure` ([server.js:133-148](server.js#L133-L148)) always reads directly from MongoDB on every call — there is no Redis caching layer on this route, unlike `/clue/:step`. Calling it twice in a row returns identical output with no `source` field. This differs from clue caching (which does use `redis.setEx` and reports `"source":"Redis Cache"` on repeat reads within 120 seconds), so don't expect to see a cache-hit behavior specifically on `/treasure`.

## Concepts Demonstrated

| Step | Concept | Redis Command(s) |
| --- | --- | --- |
| 1 | Rate Limiting | `INCR`, `EXPIRE` |
| 2 | TTL (Time-To-Live) | `SETEX` |
| 3 | Pub/Sub (event-driven architecture) | `PUBLISH`, `SUBSCRIBE` |
| 4 | Read-through caching (on `/clue/:step` only) | `GET`, `SETEX` |

## Stopping the Lab

```bash
docker compose down
```
