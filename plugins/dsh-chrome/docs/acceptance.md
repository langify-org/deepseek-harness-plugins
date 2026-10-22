# Acceptance checks

What the automated tests cannot reach: a profile set up by hand and its extensions, DSH's
real web client, the host machine's own screen, and devices other than the host. Run these
by hand before a release, on DSH Desktop with the plugin installed as the README describes
(or in the development DSH, `pnpm dev`).

The tests already cover the rest against a real Chrome in temporary profiles, on Xvnc under
Openbox (`pnpm test:integration`): the agent's tools and what their actions report, popups,
new tabs and dialogs, the screen's size following a viewer's, a viewer's clicks, keys,
composed text and clipboard, a page's window over Chrome's and its close button, Chrome
starting again with its profile, help requests, and adding the page's text and the screen to
a message.

| # | Do | Expect |
|---|---|---|
| 1 | Open **Chrome** from the right sidebar's new-tab guide. | No window appears on your screen. The tab shows the whole Chrome window, at the sidebar's size, sharp on your display. |
| 2 | Resize the sidebar, then click, double-click, select text, scroll and type in a page. Type Japanese with your input method, in the page and in Chrome's address bar. | Chrome takes the new size. Every click lands once, where you point. The composition shows at the bottom of the tab, and the finished text reaches the page or the address bar. |
| 3 | Press Ctrl+L, type an address, press Enter. Open Chrome's ⋮ menu and a site's `<select>` list. | Chrome navigates; the menu and the list open in the tab, and take clicks. |
| 4 | Copy text in Chrome with Ctrl+C, then with its context menu, and paste it outside DSH. Copy text outside DSH and paste it into a page with Ctrl+V. | Both copies reach your clipboard, and the paste reaches the page. |
| 5 | On a keyboard that has them, type characters with AltGr or Option; on a layout without Latin letters, press Ctrl+A and Ctrl+C in a page. | The characters arrive as typed; the shortcuts select and copy. |
| 6 | Sign in to a site, add 1Password from the Chrome Web Store and sign in to it, then use its in-page autofill and its toolbar popup on a login form. | 1Password's extension reaches the desktop app (unlocking it unlocks the extension). The popup and the autofill menu show in the tab, and fill the form. |
| 7 | On a page, follow a "sign in with …" button that opens a popup window, and finish signing in. | The popup shows centred over Chrome, with a title bar. It stays above Chrome's window while you click there, and closes when it is done, or with its ✕. |
| 8 | Choose a file for a site's file input, and download a file. | The file chooser opens on the host's desktop, and the page gets the file chosen there. The download goes to the host's Downloads folder, and Chrome shows it. |
| 9 | Ask the agent to open a page and summarize it. | A new tab opens in front; the agent uses `chrome_open` and `chrome_snapshot`. |
| 10 | Open a page yourself, then ask the agent about "this page". | The agent reads the page you are looking at. |
| 11 | Ask the agent to do something that needs a sign-in it does not have. | It calls `chrome_ask_user`; the request appears above Chrome; **Done** lets it continue. |
| 12 | Ask the agent to click something that asks for confirmation. | Its click reports the question; it answers with `chrome_answer_dialog`, or asks you. |
| 13 | Press 📷 and 📄 in the toolbar. | A screenshot of Chrome and the page's text are attached to your next message. |
| 14 | Open DSH from another device (a phone on the tailnet) and open the session's Chrome tab, then switch back to the first device. | The screen takes the size of the device you look at; the other shows it scaled to fit. Taps click, two-finger drags scroll, ⌨ raises the keyboard. |
| 15 | Keep watching from the other device and lock the host's screen for a minute. | Chrome keeps updating. |
| 16 | Close Chrome's last tab, then press **Open Chrome** in the sidebar. | The sidebar says Chrome is closed; Chrome starts again, still signed in. |
| 17 | Quit and restart DSH, then open the Chrome tab. | Chrome starts again, still signed in. |
