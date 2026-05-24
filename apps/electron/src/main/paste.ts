import { exec } from "node:child_process";
import { clipboard } from "electron";

function execAsync(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, (err) => (err ? reject(err) : resolve()));
  });
}

export async function pasteIntoFocusedApp(text: string): Promise<void> {
  if (!text) return;

  // Save current clipboard
  const prior = clipboard.readText();

  // Write transcribed text to clipboard
  clipboard.writeText(text);

  try {
    // Wait for clipboard to settle
    await new Promise((r) => setTimeout(r, 50));

    // Simulate Cmd+V via AppleScript
    await execAsync(
      `osascript -e 'tell application "System Events" to keystroke "v" using {command down}'`,
    );

    // Wait for paste to complete
    await new Promise((r) => setTimeout(r, 200));
  } finally {
    // Restore original clipboard
    clipboard.writeText(prior);
  }
}
