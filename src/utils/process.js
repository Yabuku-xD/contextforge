import { spawn } from "node:child_process";

export async function runShellCommand({
  command,
  cwd,
  timeoutMs = 15000,
  maxCaptureChars = Number.POSITIVE_INFINITY,
  onStdoutChunk = null,
  onStderrChunk = null
}) {
  const shell = process.env.SHELL || "/bin/sh";
  const captureLimit = Number.isFinite(maxCaptureChars)
    ? Math.max(0, maxCaptureChars)
    : Number.POSITIVE_INFINITY;

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
      const text = chunk.toString("utf8");
      if (typeof onStdoutChunk === "function") {
        onStdoutChunk(text);
      }
      if (stdout.length < captureLimit) {
        stdout += text.slice(0, captureLimit - stdout.length);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (typeof onStderrChunk === "function") {
        onStderrChunk(text);
      }
      if (stderr.length < captureLimit) {
        stderr += text.slice(0, captureLimit - stderr.length);
      }
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
