// What the model is told about the shared browser, once, in the system prompt.

export function guide(downloadsDir: string): string {
  return `## Shared browser

You and the user share a real Chromium on this machine. Its logins belong to every conversation. Each Browser tab in the user's right sidebar shows one Chromium window of this conversation, live, and the user works in it just as you do with the browser_* tools.

- The tools act on this conversation's window used last; browser_windows lists the windows and tabs, and the tools take a window id. browser_open makes a window when there is none, and the next Browser tab the user opens shows it. Ask the user to open one when they should watch.
- Only one window is on the user's screen at a time: the tab they showed last. Your tools work on every window, on the screen or not.
- browser_screenshot shows the page only, not Chromium's own menus, prompts or popups. Prefer reading the page with browser_eval when you need text.
- Files the browser downloads are saved under ${downloadsDir}, in a folder per download.`
}
