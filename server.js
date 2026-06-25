const express = require("express");
const mongoose = require("mongoose");
const { createClient } = require("redis");

const app = express();
app.use(express.json());

const MONGO_URL = process.env.MONGO_URL || "mongodb://mongo:27017/redis_treasure";
const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";

mongoose.connect(MONGO_URL);

const clueSchema = new mongoose.Schema({
	step: Number,
	message: String,
});

const treasureSchema = new mongoose.Schema({
	name: String,
	value: String,
});

const Clue = mongoose.model("Clue", clueSchema);
const Treasure = mongoose.model("Treasure", treasureSchema);

const redisClient = createClient({ url: REDIS_URL });
const subscriber = createClient({ url: REDIS_URL });

async function preloadMongo() {
	await Clue.deleteMany({});
	await Treasure.deleteMany({});

	await Clue.insertMany([
		{ step: 1, message: "The gatekeeper watches your speed. Hit this endpoint more than 5 times in a minute to break through." },
		{ step: 2, message: "Redis is great at broadcasting. Use the command 'PUBLISH treasure_channel unlock' in your Redis client to trigger a state change in the system. Only then will the /treasure vault open." },
		{ step: 3, message: "You are almost there. Verify the system state changed, then open /treasure to claim the final flag." },
	]);

	await Treasure.create({
		name: "final_flag",
		value: "FLAG{redis_king_2026}",
	});

	console.log("MongoDB preloaded");
}

async function preloadRedis() {
	await redisClient.flushAll();
	await redisClient.set("golden_key", "locked"); // Consistent state naming
	console.log("Redis preloaded");
}

async function setupSubscriber() {
	await subscriber.connect();
	// Use a dedicated client for subscribing as it blocks the connection
	await subscriber.subscribe("treasure_channel", async (message) => {
		if (message === "unlock") {
			// Update the master redis client
			await redisClient.set("golden_key", "unlocked");
			console.log("Event-Driven Architecture: Pub/Sub triggered the unlock!");
		}
	});
}

async function rateLimiter(req, res, next) {
	const ip = req.ip;
	const key = `rate_limit:${ip}`;
	const current = await redisClient.incr(key);

	if (current === 1) await redisClient.expire(key, 60);

	if (current > 5) {
		return res.status(429).json({
			concept: "Rate Limiting",
			message: "Redis tracked your requests using INCR and EXPIRE. You are moving too fast.",
			nextClue: "Create a Redis key 'temp_key' with value 'unlock' that expires in 10 seconds, then check /clue/2."
		});
	}
	next();
}

app.get("/clue/:step", rateLimiter, async (req, res) => {
	const step = parseInt(req.params.step, 10);
	const cacheKey = `clue_cache:${step}`;

	if (Number.isNaN(step)) {
		if (req.params.step === "treasure") {
			return res.status(400).json({
				message: "Use /treasure for the final vault. Clue steps must be numeric, e.g., /clue/1, /clue/2, /clue/3."
			});
		}

		return res.status(400).json({
			message: "Invalid clue step. Use a number like /clue/1, /clue/2, or /clue/3."
		});
	}

	// Gatekeeper for step 2 (must happen before cache read)
	if (step === 2) {
		const hasTempKey = await redisClient.get("temp_key");
		if (!hasTempKey) {
			return res.status(403).json({
				message: "Access denied. Set 'temp_key' in Redis with a 10-second TTL using: SETEX temp_key 10 unlock"
			});
		}
	}

	// Check cache first
	const cached = await redisClient.get(cacheKey);
	if (cached) {
		const cachedClue = JSON.parse(cached);
		return res.json({
			source: "Redis Cache",
			message: cachedClue.message
		});
	}

	// Fetch from MongoDB
	const clue = await Clue.findOne({ step });
	if (!clue) {
		return res.status(404).json({ message: "This step in the journey does not exist yet." });
	}

	// Store in cache for 2 minutes
	await redisClient.setEx(cacheKey, 120, JSON.stringify(clue));

	res.json({
		source: "MongoDB",
		message: clue.message
	});
});

app.get("/treasure", async (req, res) => {
	const status = await redisClient.get("golden_key");

	if (status !== "unlocked") {
		return res.status(403).json({
			concept: "Distributed State",
			message: "The vault is locked. Use Redis Pub/Sub to change 'golden_key' to 'unlocked'."
		});
	}

	const treasure = await Treasure.findOne({ name: "final_flag" });
	res.json({
		message: "Congratulations! You mastered Rate Limiting, TTL, Caching, and Pub/Sub.",
		treasure: treasure.value
	});
});

async function start() {
	try {
		await redisClient.connect();
		await preloadMongo();
		await preloadRedis();
		await setupSubscriber();

		app.listen(7000, () =>
			console.log("Treasure Hunt Server running at http://localhost:7000")
		);
	} catch (err) {
		console.error("Failed to start services:", err);
	}
}

start();
