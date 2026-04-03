import { spawn } from "node:child_process";

export async function runShellCommand({
  command,
  cwd,
  timeoutMs = 15000
}) {
  const shell = process.env.SHELL || "/bin/sh";

  return new Promise((resolve) => {
    const child = spawn(shell, ["-lc", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 750).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        command,
        cwd,
        exitCode: null,
        stdout,
        stderr: stderr || String(error?.message ?? error),
        timedOut
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      finish({
        command,
        cwd,
        exitCode: code,
        stdout,
        stderr,
        timedOut
      });
    });
  });
}
