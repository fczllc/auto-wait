import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const directory = await mkdtemp(new URL(".fast-test-", import.meta.url));
let fast;
try {
	const outfile = join(directory, "fast.mjs");
	await build({
		entryPoints: ["src/codex-fast.ts"],
		outfile,
		bundle: true,
		packages: "external",
		platform: "node",
		format: "esm",
	});
	fast = await import(pathToFileURL(outfile).href);
} finally {
	await rm(directory, { recursive: true, force: true });
}
const model = (id, overrides = {}) => ({
	id,
	provider: "openai-codex",
	api: "openai-codex-responses",
	baseUrl: "https://chatgpt.com/backend-api/codex",
	...overrides,
});

for (const id of [
	...fast.CODEX_FAST_MODEL_IDS,
	"gpt-6",
	"gpt-6-sol",
	"gpt-6.1",
	"gpt-6.1-sol",
	"gpt-6-astra",
	"gpt-7",
	"gpt-10.2-codex",
]) {
	test(`${id}: availability and enabled/disabled request routing agree`, () => {
		assert.deepEqual(fast.codexFastAvailability(model(id), true), {
			kind: "available",
			enabled: true,
		});
		assert.equal(fast.codexFastIsEffective(model(id), true), true);
		assert.equal(fast.codexFastIsEffective(model(id), false), false);
		const payload = { input: ["hello"], service_tier: "auto" };
		assert.deepEqual(fast.rewriteCodexFastPayload(payload, model(id), true), {
			...payload,
			service_tier: "priority",
		});
		assert.deepEqual(fast.rewriteCodexFastPayload(payload, model(id), false), {
			...payload,
			service_tier: "default",
		});
		assert.equal(payload.service_tier, "auto");
	});
}
for (const id of [
	"gpt-5",
	"gpt-5.6",
	"gpt-5.7-sol",
	"gpt-60oops",
	"gpt-06",
	"gpt-6.",
	"gpt-6-",
	"gpt-6/sol",
	"chatgpt-6",
	"o6",
]) {
	test(`${id}: other models keep existing standard routing`, () => {
		assert.equal(
			fast.codexFastAvailability(model(id), true).kind,
			"unavailable",
		);
		assert.equal(fast.codexFastRequestTier(model(id), true), "default");
	});
}
test("provider, API and official origin restrictions still apply", () => {
	for (const candidate of [
		undefined,
		model("gpt-6", { provider: "openai" }),
		model("gpt-6", { api: "openai-responses" }),
		model("gpt-6", { baseUrl: "https://proxy.example/codex" }),
		model("gpt-6", { baseUrl: "https://chatgpt.com.example" }),
		model("gpt-6", { baseUrl: "invalid" }),
	]) {
		assert.notEqual(
			fast.codexFastAvailability(candidate, true).kind,
			"available",
		);
		assert.equal(fast.rewriteCodexFastPayload({}, candidate, true), undefined);
	}
	for (const payload of [null, [], "hello"])
		assert.equal(
			fast.rewriteCodexFastPayload(payload, model("gpt-6"), true),
			undefined,
		);
});

test("new models do not inherit an unverified Fast cost multiplier", () => {
	const candidate = model("gpt-6-sol", {
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
	});
	const message = {
		role: "assistant",
		provider: candidate.provider,
		model: candidate.id,
		usage: {
			input: 100,
			output: 100,
			cacheRead: 0,
			cacheWrite: 0,
			cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
		},
	};
	assert.equal(
		fast.correctCodexFastMessageCost(message, candidate, true),
		undefined,
	);
});
test("legacy Fast cost correction retains existing multipliers", () => {
	for (const id of fast.CODEX_FAST_MODEL_IDS) {
		const candidate = model(id, {
			cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
		});
		const message = {
			role: "assistant",
			provider: candidate.provider,
			model: id,
			usage: {
				input: 1000000,
				output: 1000000,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
			},
		};
		assert.equal(
			fast.correctCodexFastMessageCost(message, candidate, true).usage.cost
				.total,
			3 * (id === "gpt-5.5" ? 2.5 : 2),
		);
		assert.equal(
			fast.correctCodexFastMessageCost(message, candidate, false),
			undefined,
		);
	}
});
