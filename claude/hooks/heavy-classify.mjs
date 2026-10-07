#!/usr/bin/env node
//
// heavy-classify.mjs — decide whether an agent's shell command is a heavy job
// and rewrite it. Used by heavy-gate.sh (the Bash PreToolUse hook).
//
//  - Vitest runs on the repo's default config get --maxWorkers=4. Vitest
//    otherwise starts one worker per core (17 here), 100-450 MB each. Runs that
//    pick their own --config or worker count are left alone: several suites
//    must run one file at a time against an emulator or database.
//  - Heavy jobs (a Vitest run with no file filter, build, whole-project
//    typecheck or lint) are wrapped in ~/.claude/bin/heavy, which queues them
//    so only two run at once machine-wide.
//
// Prints the rewritten command, or nothing when the command is left alone.
// Usage: heavy-classify.mjs <command> [cwd]
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VITEST_WORKERS = process.env.AGENT_VITEST_MAX_WORKERS || "4";
const HEAVY_SCRIPTS = new Set(["build", "typecheck", "typecheck:tests", "typecheck:ts6", "lint", "test:firestore-writer-conformance"]);
const VITEST_SCRIPTS = new Set(["test", "test:run", "test:coverage"]);
const VITEST_VALUE_FLAGS = new Set([
	"--config", "-c", "--project", "-t", "--testNamePattern", "--reporter", "--outputFile", "--maxWorkers",
	"--environment", "--dir", "--root", "-r", "--shard", "--exclude", "--pool", "--mode", "--bail", "--retry",
	"--testTimeout", "--hookTimeout", "--maxConcurrency", "--sequence.seed", "--inspect-brk", "--inspect",
]);

// Split into segments at && || ; | & and newlines outside quotes, keeping offsets.
function segments(cmd) {
	const out = [];
	let start = 0, q = null;
	for (let i = 0; i < cmd.length; i++) {
		const c = cmd[i];
		if (q) {
			if (c === "\\" && q === '"') i++;
			else if (c === q) q = null;
			continue;
		}
		if (c === "\\") { i++; continue; }
		if (c === "'" || c === '"') { q = c; continue; }
		const two = cmd.slice(i, i + 2);
		// `2>&1`, `&>file` and `|&` are redirections, not separators.
		const redirect = c === "&" && (cmd[i - 1] === ">" || cmd[i + 1] === ">" || cmd[i - 1] === "|");
		const sep = two === "&&" || two === "||" ? 2 : !redirect && ";|&\n".includes(c) ? 1 : 0;
		if (sep) {
			out.push({ start, end: i });
			i += sep - 1;
			start = i + 1;
		}
	}
	out.push({ start, end: cmd.length });
	return out;
}

// Words of one segment with their offsets; quotes are removed from the text.
function words(cmd, from, to) {
	const out = [];
	let i = from;
	while (i < to) {
		while (i < to && /\s/.test(cmd[i])) i++;
		if (i >= to) break;
		const s = i;
		let text = "", q = null;
		for (; i < to; i++) {
			const c = cmd[i];
			if (q) { if (c === q) q = null; else text += c; continue; }
			if (/\s/.test(c)) break;
			if (c === "'" || c === '"') { q = c; continue; }
			text += c;
		}
		out.push({ text, start: s, end: i });
	}
	return out;
}

function scriptIsVitest(cwd, name) {
	try {
		const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
		return /^\s*vitest(\s|$)/.test(pkg.scripts?.[name] ?? "");
	} catch {
		return false;
	}
}

// Returns { heavy, insert: [{at, text}] } for one segment.
function analyse(cmd, seg, cwd, hasCd) {
	let w = words(cmd, seg.start, seg.end);
	const none = { heavy: false, insert: [] };
	const skipPrefix = () => {
		while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0].text) || ["time", "env", "cross-env", "nice", "command", "exec"].includes(w[0].text))) w = w.slice(1);
	};
	skipPrefix();
	if (!w.length) return none;
	let prog = w[0].text;
	let at = 0;
	if (["npx", "bunx", "pnpx"].includes(prog)) {
		at = 1;
		while (at < w.length && w[at].text.startsWith("-")) at++;
		if (at >= w.length) return none;
		prog = w[at].text;
	} else if (["npm", "pnpm", "yarn"].includes(prog) && w[1]?.text === "exec") {
		at = 2;
		while (at < w.length && w[at].text.startsWith("-")) at++;
		if (at >= w.length) return none;
		prog = w[at].text;
	}
	const base = prog.split("/").pop().replace(/@[^/]*$/, "");
	// Redirections (`2>&1`, `> out.txt`) are not arguments.
	const args = [];
	const rest = w.slice(at + 1);
	for (let i = 0; i < rest.length; i++) {
		const t = rest[i].text;
		if (/^(\d*|&)(>>?|<)(&?\d+)?$/.test(t)) { if (!/&\d+$/.test(t)) i++; continue; }
		if (/^(\d*|&)(>>?|<)./.test(t)) continue;
		args.push(rest[i]);
	}
	const flag = (re) => args.some((a) => re.test(a.text));

	if (base === "vitest") {
		const sub = args[0]?.text;
		if (["watch", "dev", "list", "init", "bench"].includes(sub)) return none;
		if (flag(/^(--watch|-w|--ui|--version|-v|--help|-h)$/)) return none;
		let positional = false;
		for (let i = sub === "run" || sub === "related" ? 1 : 0; i < args.length; i++) {
			const a = args[i].text;
			if (a.startsWith("-")) { if (VITEST_VALUE_FLAGS.has(a)) i++; continue; }
			positional = true;
		}
		const insert = [];
		const ownConfig = flag(/^(--config|-c)(=|$)/);
		const ownWorkers = flag(/^(--maxWorkers|--no-file-parallelism|--fileParallelism|--pool)(=|$)/);
		if (!ownConfig && !ownWorkers) {
			const after = sub === "run" || sub === "related" ? args[0] : w[at];
			insert.push({ at: after.end, text: ` --maxWorkers=${VITEST_WORKERS}` });
		}
		return { heavy: !positional, insert };
	}

	if (["npm", "pnpm", "yarn"].includes(base) && at === 0) {
		if (flag(/^(--workspace|-w|--workspaces|--prefix)(=|$)/)) return none;
		let script, scriptWord;
		if (w[1]?.text === "test" || w[1]?.text === "t") { script = "test"; scriptWord = w[1]; }
		else if (w[1]?.text === "run" || w[1]?.text === "run-script") { script = w[2]?.text; scriptWord = w[2]; }
		if (!script) return none;
		if (HEAVY_SCRIPTS.has(script)) return { heavy: true, insert: [] };
		if (!VITEST_SCRIPTS.has(script)) return none;
		const dd = w.findIndex((x) => x.text === "--");
		const extra = dd >= 0 ? w.slice(dd + 1) : [];
		if (extra.some((a) => /^(--maxWorkers|--no-file-parallelism|--config|-c|--watch|--ui)(=|$)/.test(a.text))) return none;
		const positional = extra.some((a, i) => !a.text.startsWith("-") && !VITEST_VALUE_FLAGS.has(extra[i - 1]?.text));
		const insert = [];
		if (!hasCd && scriptIsVitest(cwd, script)) {
			insert.push(dd >= 0
				? { at: w[dd].end, text: ` --maxWorkers=${VITEST_WORKERS}` }
				: { at: w[w.length - 1].end, text: ` -- --maxWorkers=${VITEST_WORKERS}` });
		}
		return { heavy: !positional, insert };
	}

	if (base === "next" && args[0]?.text === "build") return { heavy: true, insert: [] };

	if (base === "tsc" || base === "tsc6") {
		if (flag(/^(--version|-v|--help|-h|--init|--watch|-w)$/)) return none;
		const files = args.some((a) => !a.text.startsWith("-") && /\.(ts|tsx|mts|cts)$/.test(a.text));
		return { heavy: !files, insert: [] };
	}

	if (base === "eslint") {
		if (flag(/^(--version|-v|--help|-h|--print-config)$/)) return none;
		const pos = args.filter((a) => !a.text.startsWith("-"));
		const onlyFiles = pos.length > 0 && pos.every((a) => /\.[cm]?[jt]sx?$/.test(a.text));
		return { heavy: !onlyFiles, insert: [] };
	}
	return none;
}

export function classify(cmd, cwd = process.cwd()) {
	if (cmd.includes(".claude/bin/heavy")) return null;
	const segs = segments(cmd);
	const hasCd = segs.some((s) => /^\s*cd(\s|$)/.test(cmd.slice(s.start, s.end)));
	let heavy = false;
	const inserts = [];
	for (const s of segs) {
		const r = analyse(cmd, s, cwd, hasCd);
		heavy ||= r.heavy;
		inserts.push(...r.insert);
	}
	if (!heavy && !inserts.length) return null;
	let out = cmd;
	for (const ins of inserts.sort((a, b) => b.at - a.at)) out = out.slice(0, ins.at) + ins.text + out.slice(ins.at);
	if (!heavy) return out;
	const shell = existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash";
	const home = process.env.HOME;
	return `${home}/.claude/bin/heavy ${shell} -c '${out.replace(/'/g, `'\\''`)}'`;
}

// Run as a script (via the ~/.claude/hooks symlink, so compare real paths).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const out = classify(process.argv[2] ?? "", process.argv[3] || process.cwd());
	if (out) process.stdout.write(out);
}
