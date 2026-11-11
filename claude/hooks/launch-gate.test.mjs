// node --test ~/dotfiles/claude/hooks/launch-gate.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { denial, emulators } from "./launch-gate.mjs";

const QEMU = "/opt/homebrew/share/android-commandlinetools/emulator/qemu/darwin-aarch64/qemu-system-aarch64-headless";
const emu = (pid, avd, port) => ({ pid, ppid: 1, rssKB: 6e6, ageSec: 3600, cmd: `${QEMU} -avd ${avd} -port ${port} -no-window` });
const shell = { pid: 9, ppid: 1, rssKB: 1e3, ageSec: 10, cmd: "/bin/zsh" };
const EMU = "/opt/homebrew/share/android-commandlinetools/emulator/emulator";

test("a second emulator is refused while one runs", () => {
	const reason = denial(`${EMU} -avd sideshift-api36-b -port 5582 -no-window`, [emu(1, "sideshift-api36", 5580)]);
	assert.match(reason ?? "", /1 Android emulator\(s\) already running .*limit 1/);
	assert.match(reason, /emulator-5580 \(AVD sideshift-api36\)/);
	assert.match(reason, /ANDROID_SERIAL/);
});

test("the first emulator is allowed", () => {
	assert.equal(denial(`${EMU} -avd sideshift-api36 -port 5580`, [shell]), null);
});

test("other spellings that boot one are caught", () => {
	const running = [emu(1, "a", 5580)];
	for (const cmd of [
		`nohup ${EMU} -avd x -port 5582 > /tmp/emu.log 2>&1 &`,
		"emulator @sideshift-api36",
		`cd /tmp && ${EMU} -no-window -avd x`,
		`"$ANDROID_HOME/emulator/emulator" -avd x`,
	]) assert.ok(denial(cmd, running), cmd);
});

test("commands that do not boot one pass", () => {
	const running = [emu(1, "a", 5580), emu(2, "b", 5582)];
	for (const cmd of [
		`${EMU} -list-avds`,
		"adb -s emulator-5580 install app.apk",
		"./gradlew :app:connectedDebugAndroidTest",
		"git commit -m 'start the emulator -avd x first'",
		"grep -rn emulator android/AGENTS.md",
	]) assert.equal(denial(cmd, running), null, cmd);
});

test("AGENT_MAX_EMULATORS in the command raises the limit", () => {
	const running = [emu(1, "a", 5580)];
	assert.equal(denial(`AGENT_MAX_EMULATORS=2 ${EMU} -avd b -port 5582`, running), null);
	assert.ok(denial(`AGENT_MAX_EMULATORS=2 ${EMU} -avd c -port 5584`, [...running, emu(2, "b", 5582)]));
});

test("emulators() reads the AVD, serial and last user", () => {
	const dir = mkdtempSync(join(tmpdir(), "sims-"));
	writeFileSync(join(dir, "android:emulator-5588"), "abc12345-session\n");
	const [e] = emulators([emu(7, "sideshift-api36-e", 5588), shell], dir);
	assert.deepEqual({ avd: e.avd, serial: e.serial, owner: e.owner }, { avd: "sideshift-api36-e", serial: "emulator-5588", owner: "abc12345-session" });
});
