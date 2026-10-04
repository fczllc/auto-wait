import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Run through npm so its CLI path is available on every platform.
assert.ok(process.env.npm_execpath, "Run with npm run test:install");
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "auto-wait-install-"));
const fixture = join(temporaryRoot, "source");
const checkout = join(temporaryRoot, "checkout");
const hostEntry = fileURLToPath(
	import.meta.resolve("@earendil-works/pi-coding-agent"),
);
const { loadExtensions } = await import(
	pathToFileURL(join(dirname(hostEntry), "core/extensions/loader.js"))
);
const hostManifest = JSON.parse(
	await readFile(join(dirname(hostEntry), "../package.json"), "utf8"),
);
function git(args, cwd) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}
function install() {
	execFileSync(
		process.execPath,
		[process.env.npm_execpath, "install", "--omit=dev", "--legacy-peer-deps"],
		{ cwd: checkout, stdio: "inherit" },
	);
}
async function verify(stage) {
	const manifest = JSON.parse(
		await readFile(join(checkout, "package.json"), "utf8"),
	);
	assert.deepEqual(manifest.pi.extensions, ["./src/index.ts"]);
	for (const dependency of [
		"esbuild",
		"typescript",
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-ai",
	]) {
		await assert.rejects(
			readFile(join(checkout, "node_modules", dependency, "package.json")),
			{ code: "ENOENT" },
		);
	}
	await assert.rejects(readFile(join(checkout, "dist/index.ts")), {
		code: "ENOENT",
	});
	await readFile(
		join(checkout, "node_modules/@narumitw/pi-tui-kit/package.json"),
	);
	const loaded = await loadExtensions(
		manifest.pi.extensions.map((path) => resolve(checkout, path)),
		checkout,
	);
	assert.deepEqual(loaded.errors, []);
	assert.equal(loaded.extensions.length, 1);
	const extension = loaded.extensions[0];
	assert.deepEqual([...extension.commands.keys()].sort(), [
		"autowait",
		"fast",
		"usage",
	]);
	assert.ok(extension.handlers.has("before_provider_request"));
	assert.ok(extension.handlers.has("before_agent_start"));
	assert.ok(extension.handlers.has("agent_end"));
	console.log(
		`${stage}: source loaded with Pi ${hostManifest.version}; all three commands registered; production dependencies only; no dist`,
	);
}
try {
	await mkdir(fixture);
	// Copy only package inputs, including the current working-tree manifest.
	for (const path of [
		"src",
		"package.json",
		"package-lock.json",
		".gitignore",
		"README.md",
		"LICENSE",
	]) {
		await cp(join(packageRoot, path), join(fixture, path), { recursive: true });
	}
	git(["init", "-b", "main"], fixture);
	git(["add", "."], fixture);
	git(
		[
			"-c",
			"user.name=Install test",
			"-c",
			"user.email=install-test@example.invalid",
			"commit",
			"-m",
			"fixture",
		],
		fixture,
	);
	git(["clone", fixture, checkout], temporaryRoot);
	install();
	await verify("Fresh Git install");
	await mkdir(join(checkout, "dist"));
	await writeFile(
		join(checkout, "dist/index.ts"),
		"// stale generated artifact\n",
	);
	// Advance the fixture so the update follows Pi's fetch/reset/clean/reinstall path.
	await writeFile(join(fixture, "README.md"), "Updated installation fixture\n");
	git(["add", "README.md"], fixture);
	git(
		[
			"-c",
			"user.name=Install test",
			"-c",
			"user.email=install-test@example.invalid",
			"commit",
			"-m",
			"update fixture",
		],
		fixture,
	);
	git(["fetch", "origin", "main"], checkout);
	git(["reset", "--hard", "FETCH_HEAD"], checkout);
	git(["clean", "-fdx"], checkout);
	install();
	await verify("Git update after clean -fdx");
} finally {
	// Both disposable clones are created inside this exact temporary directory.
	await rm(temporaryRoot, { recursive: true, force: true });
}
