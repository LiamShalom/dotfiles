// node --test ~/dotfiles/claude/hooks/heavy-classify.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classify } from "./heavy-classify.mjs";

const MONO = "/Users/x/sideshift-monorepo/.claude/worktrees/feat+thing";
const OTHER = "/Users/x/session-board";
const refused = (cmd, cwd = MONO) => Boolean(classify(cmd, cwd)?.refuse);
const queued = (cmd, cwd = MONO) => typeof classify(cmd, cwd) === "string" && classify(cmd, cwd).includes("/.claude/bin/heavy");

test("whole-repo type checks in the monorepo are refused", () => {
	for (const cmd of [
		"npm run typecheck",
		"npm run typecheck --silent",
		"npm run typecheck 2>&1 | tail -5",
		"npm run typecheck:tests",
		"npm run typecheck:ts6",
		"npx tsc --noEmit",
		"npx tsc --noEmit -p . --pretty false",
		"npx tsc -p tsconfig.tests.json --noEmit",
		"node_modules/.bin/tsc --noEmit --project=tsconfig.json",
		"git status && npm run typecheck",
	]) assert.ok(refused(cmd), cmd);
});

test("a command that names the monorepo is refused from any directory", () => {
	assert.ok(refused("cd /Users/x/sideshift-monorepo && npm run typecheck", "/tmp"));
});

test("other spellings of the same check are refused", () => {
	for (const cmd of [
		"npm run -s typecheck",
		"npm run --silent typecheck",
		"pnpm typecheck",
		"yarn typecheck:tests",
		"(cd . && npm run typecheck)",
		"npx tsc -p /Users/x/sideshift-monorepo/tsconfig.json --noEmit",
		"npx tsc -p /Users/x/sideshift-monorepo/.claude/worktrees/feat+thing/tsconfig.tests.json --noEmit",
	]) assert.ok(refused(cmd), cmd);
});

test("the repo is the directory the command runs in, not a path it mentions", () => {
	assert.ok(!refused("cat /Users/x/sideshift-monorepo/package.json && npm run typecheck", OTHER));
	assert.ok(!refused("cd /Users/x/session-board && npm run typecheck"));
	assert.ok(queued("cd /Users/x/session-board && npm run typecheck"));
	assert.ok(refused("cd ~/sideshift-monorepo && npm run typecheck", OTHER));
});

test("text in a heredoc body is not a command", () => {
	assert.ok(!refused("cat > notes.md <<'EOF'\nnpm run typecheck\nnpx tsc --noEmit\nEOF"));
	assert.ok(!refused("cat > notes.md <<EOF\nrun this:\nnpm run typecheck\nEOF\nls"));
	assert.ok(refused("cat > notes.md <<'EOF'\nsome text\nEOF\nnpm run typecheck"));
});

test("LOCAL_TYPECHECK=1 runs the check, queued", () => {
	assert.ok(queued("LOCAL_TYPECHECK=1 npm run typecheck"));
	assert.ok(queued("LOCAL_TYPECHECK=1 npx tsc --noEmit"));
});

test("the shared-package build is queued", () => {
	assert.ok(queued("npm run build:packages"));
	assert.ok(!refused("npm run build:packages"));
});

test("Gradle builds and tests are queued; info tasks are not", () => {
	assert.ok(queued("cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew :core:test --tests '*X*'", OTHER));
	assert.ok(queued("./gradlew assembleDebug", OTHER));
	assert.ok(queued("gradle recordRoborazziDebug", OTHER));
	for (const cmd of [
		"./gradlew --version", "./gradlew --stop", "./gradlew tasks", "./gradlew :app:dependencies",
		"cat > /tmp/x.sh <<'EOF'\n./gradlew test\nxcodebuild test -scheme S\nEOF",
	]) {
		assert.ok(!queued(cmd, OTHER), cmd);
	}
});

test("other repos keep the queue", () => {
	assert.ok(queued("npm run typecheck", OTHER));
	assert.ok(queued("npx tsc --noEmit", OTHER));
});

test("small or unrelated commands in the monorepo are not refused", () => {
	for (const cmd of [
		"npx tsc -p services/validation-shadow/tsconfig.test.json --noEmit",
		"npx tsc --noEmit lib/foo.ts",
		"npx tsc --version",
		"node_modules/@typescript/typescript-darwin-arm64/lib/tsc --lsp --stdio",
		"npm run typecheck --workspace scrape-contracts",
		"npm run typecheck:scripts",
		"npx vitest run lib/foo.test.ts",
		"npm run build",
		"git commit -m 'stop running npm run typecheck locally'",
		"grep -rn 'npm run typecheck' docs",
	]) assert.ok(!refused(cmd), cmd);
});

test("the hook denies the tool call and names the override", () => {
	const hook = fileURLToPath(new URL("./heavy-gate.sh", import.meta.url));
	const run = (command) => execFileSync("bash", [hook], { input: JSON.stringify({ tool_input: { command }, cwd: MONO }), encoding: "utf8" });
	const out = JSON.parse(run("npm run typecheck"));
	assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
	assert.match(out.hookSpecificOutput.permissionDecisionReason, /LOCAL_TYPECHECK=1/);
	const allowed = JSON.parse(run("LOCAL_TYPECHECK=1 npm run typecheck"));
	assert.equal(allowed.hookSpecificOutput.permissionDecision, undefined);
	assert.match(allowed.hookSpecificOutput.updatedInput.command, /bin\/heavy/);
	assert.equal(run("ls"), "");
});
