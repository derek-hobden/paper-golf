import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The fleet template's hook scripts: its shell tests, and fail-closed auto-approve. */

function check(
  command: string,
  projectDir: string,
): { approved: boolean; reason: string } {
  const input = JSON.stringify({
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: { command },
  });
  // A clean environment: only PATH, the input and the project whose deny list is read.
  const script =
    'env -i PATH="$PATH" HOME="$HOME" HOOK_INPUT="$1" CLAUDE_PROJECT_DIR="${2:-$PWD}" FACTORY_AUTO_APPROVE=1 bash scripts/claude-hooks/auto-approve.sh --check';
  const r = spawnSync("bash", ["-c", script, "check", input, projectDir], {
    encoding: "utf8",
    timeout: 20_000,
  });
  return { approved: r.status === 0, reason: r.stdout.trim() };
}

const hasTools = (...cmds: string[]): boolean =>
  cmds.every((c) => spawnSync("bash", ["-c", `command -v ${c}`], { encoding: "utf8" }).status === 0);

describe.skipIf(!hasTools("python3", "jq", "curl"))("fleet template shell tests", () => {
  it.each(["bot-ping", "auto-approve", "check-model-effort", "no-main-without-pr"])(
    "%s.test.sh passes",
    (name) => {
      const r = spawnSync("bash", [`scripts/__tests__/${name}.test.sh`], {
        encoding: "utf8",
        timeout: 120_000,
      });
      expect(r.stdout + r.stderr).toMatch(/fail(=|ures: )0\b/);
      expect(r.status).toBe(0);
    },
    150_000,
  );
});

describe.skipIf(!hasTools("python3"))("auto-approve fails closed", () => {
  const repo = "";

  it("approves an ordinary command with the real deny list", () => {
    expect(check("npm run check", repo).approved).toBe(true);
  });

  it.each([
    "git push --force origin claude/x",
    "gh repo delete derek-hobden/paper-golf --yes",
    "cat .env",
  ])("refuses %s", (command) => {
    expect(check(command, repo).approved).toBe(false);
  });

  it("approves nothing when the deny list is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-"));
    mkdirSync(join(dir, ".claude"));
    writeFileSync(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(*)"] } }),
    );
    const r = check("npm run check", dir);
    expect(r.approved).toBe(false);
    expect(r.reason).toMatch(/deny_list_missing/);
  });
});
