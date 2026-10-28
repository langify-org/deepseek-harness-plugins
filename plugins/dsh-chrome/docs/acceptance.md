# Acceptance checks

What the automated tests cannot reach: a profile set up by hand and its extensions, DSH's
real web client, the host machine's own screen, and devices other than the host. Run these
by hand before a release, on DSH Desktop with the plugin installed as the README describes
(or in the development DSH, `pnpm dev`).

The tests already cover the rest against a real Chrome in temporary profiles, on Xvnc under
Openbox (`pnpm test:integration`): the agent's tools and what their actions report, popups,
new tabs and dialogs, each session's window on its own part of the screen and its size
following its viewer's, two sessions' tabs each showing their own window and getting their
own keys (also after the other's agent took the keyboard), a viewer's clicks, keys, composed
text and clipboard, a page's window over its opener's and its close button, Chrome staying up
and starting again with its profile, WebGL, pages not being told Chrome is automated, help
requests, adding the page's text and the screen to a message, the settings page drawn from
the configuration schema, copying a profile from a stand-in for your Chrome, and Chrome taking
the pixel ratio of the display the tab is on.

| # | Do | Expect |
|---|---|---|
| 1 | Open **Chrome** from the right sidebar's new-tab guide. | No window appears on your screen. The tab shows a Chrome window with the new tab page, at the sidebar's size, as sharp as your display shows; a page's `devicePixelRatio` is your display's. No bar warns of an unsupported command-line flag. |
| 2 | Resize the sidebar, then click, double-click, select text, scroll and type in a page. Type Japanese with your input method, in the page and in Chrome's address bar. | Chrome takes the new size. Every click lands once, where you point. The composition shows at the bottom of the tab, and the finished text reaches the page or the address bar. |
| 3 | Press Ctrl+L, type an address, press Enter. Open Chrome's ⋮ menu and a site's `<select>` list. | Chrome navigates; the menu and the list open in the tab, and take clicks. |
| 4 | Copy text in Chrome with Ctrl+C, then with its context menu, and paste it outside DSH. Copy text outside DSH and paste it into a page with Ctrl+V. | Both copies reach your clipboard, and the paste reaches the page. |
| 5 | On a keyboard that has them, type characters with AltGr or Option; on a layout without Latin letters, press Ctrl+A and Ctrl+C in a page. | The characters arrive as typed; the shortcuts select and copy. |
| 6 | Sign in to Chrome itself with a Google account (the profile button, then **Turn on sync**), and to Gmail. | Google takes the password and the second step; sync turns on. Google does not say the browser "may not be secure". |
| 7 | Sign in to a site, add 1Password from the Chrome Web Store and sign in to it, then use its in-page autofill and its toolbar popup on a login form. | 1Password's extension reaches the desktop app (unlocking it unlocks the extension). The popup and the autofill menu show in the tab, and fill the form. |
| 8 | On a page, follow a "sign in with …" button that opens a popup window, and finish signing in. | The popup shows over the page's window, in the same tab, with a title bar. It stays above that window while you click there, and closes when it is done, or with its ✕. |
| 9 | Choose a file for a site's file input, and download a file. | The file chooser opens on the host's desktop, and the page gets the file chosen there. The download goes to the host's Downloads folder, and Chrome shows it. |
| 10 | Ask the agent to open a page and summarize it. | A new tab opens in front, in the session's window; the agent uses `chrome_open` and `chrome_snapshot`. |
| 11 | Open a page yourself, then ask the agent about "this page". | The agent reads the page you are looking at. |
| 12 | Ask the agent to do something that needs a sign-in it does not have. | It calls `chrome_ask_user`; the request appears above Chrome; **Done** lets it continue. |
| 13 | Ask the agent to click something that asks for confirmation. | Its click reports the question; it answers with `chrome_answer_dialog`, or asks you. |
| 14 | Press 📷 and 📄 in the toolbar. | A screenshot of Chrome and the page's text are attached to your next message. |
| 15 | Open DSH from another device (a phone on the tailnet) and open the session's Chrome tab, then switch back to the first device. | The session's window takes the size of the device you look at; the other shows it scaled to fit. Taps click, two-finger drags scroll, ⌨ raises the keyboard. |
| 16 | Keep watching from the other device and lock the host's screen for a minute. | Chrome keeps updating. |
| 17 | Close the session's last tab in Chrome, then press **Open a window** in the sidebar. Then quit Chrome from its ⋮ menu, and press **Open Chrome**. | The sidebar says the session has no window, and opens one; then that Chrome is closed, and Chrome starts again, still signed in. |
| 18 | Quit and restart DSH, then open the Chrome tab. | Chrome starts again, still signed in. |
| 19 | Open two sessions side by side (two DSH windows, or DSH and a browser), each with its Chrome tab. Open a page in each, ask one session's agent to work on its page, and type in the other session's page meanwhile. | Each tab shows its own session's window, at its own size. Your keys reach the page you type in, not the agent's. |
| 20 | Open **Plugins**, dsh-chrome's page. Turn **announceAutomation** on. | The page shows `executable`, `deviceScaleFactor` (`auto`, or a number), `announceAutomation`, `webgl` and `shareNativeHosts` with their descriptions. The Chrome tab offers **Restart Chrome**; after it, a page's `navigator.webdriver` is true. Turn it off again, and restart. |
| 21 | Open a WebGL page (`https://get.webgl.org/`, a 3D map). | It draws, and moves smoothly. |
| 22 | On dsh-chrome's page in **Plugins**, under **Copy a profile of your Chrome**, choose a profile of your own Chrome and **Copy…**, then confirm. Reload the page while it copies, and again once it is done. Open the Chrome tab. | The page lists your Chrome's profiles with their accounts, and asks before copying. It shows how far the copy has come (the megabytes copied, then the databases checked, then Chrome closing), also after the reload, and how it ended after the second. Chrome closes in every session; afterwards it is signed in to the sites, with the bookmarks, passwords and extensions of that profile. `Default.before-copy` in the profile directory holds the earlier profile. |
| 23 | Move the window that shows DSH to a display of another pixel ratio (or zoom DSH's page to 125 % or more), and look at the Chrome tab; open the same session in a second window on the first display. | The moved tab offers **Restart Chrome**, and the other does not. After the restart from the moved tab, Chrome is as sharp as that display shows, and the other tab offers it instead. |
