# Acceptance checks

What the automated tests cannot reach: a profile set up by hand and its extensions, DSH's
real web client, the host's screen, and devices other than the host. Run these by hand
before a release, on DSH Desktop with the plugin installed as the README describes (or in
the development DSH, `pnpm dev`).

The tests already cover the rest against a real Chrome in temporary profiles: the
connector, page actions, the agent's tools, frames and layout (steady at the viewer's size
in the hidden Chrome), input including composed text, popups and new tabs, dialogs, help
requests, adding a page to a message, moving the dedicated Chrome to a display of its own
and back, and a host restart (`pnpm test:integration`).

## The hidden Chrome (the default)

| # | Do | Expect |
|---|---|---|
| 1 | Open **Chrome** from the right sidebar's new-tab guide and enter an address. | No window appears on your screen. The sidebar shows the page at the sidebar's size, with **⚙** in the toolbar. |
| 2 | Resize the sidebar, then click, scroll and type in the page. Type Japanese with your input method. Watch a moving page for a minute. | The page relays out to the new size. Input lands where you point; the composition shows at the bottom of the sidebar and only the finished text reaches the page. The page never flickers to another size. |
| 3 | Press **⚙**. Sign in to a site, add 1Password from the Chrome Web Store and sign in to it, then press **Done**. | Chrome's window appears on the host's screen, and the sidebar says so above the page. 1Password's extension reaches the desktop app (unlocking it unlocks the extension). After **Done**, the window is gone. |
| 4 | Open the site again, then use 1Password's in-page autofill on a login form. | You are still signed in. The autofill menu appears in the sidebar and fills the form. |
| 5 | On a page, follow a "sign in with …" button that opens a popup, and finish signing in. | The sidebar shows the popup, and the page again once the popup closes. Both are in the page list meanwhile. |
| 6 | On a page that asks for confirmation (a `confirm`, or leaving a page with unsaved changes), answer **Cancel**, then do it again and answer **OK**. | The question appears above the page with the page's words; the page waits, and takes each answer. |
| 7 | Ask the agent to open a page and summarize it. | The tab switches to the agent's page; the agent uses `chrome_open` and `chrome_snapshot`. |
| 8 | Ask the agent to do something that needs a sign-in it does not have. | It calls `chrome_ask_user`; the request appears above the page; **Done** lets it continue. |
| 9 | Ask the agent to click something that asks for confirmation. | Its click reports the question; it answers with `chrome_answer_dialog`, or asks you. |
| 10 | Press 📷 and 📄 in the toolbar. | A screenshot and the page's text are attached to your next message. |
| 11 | Open DSH from another device (a phone on the tailnet) and open the same session's Chrome tab. | The page appears, laid out for the device that last touched it; taps click, drags scroll, ⌨ raises the keyboard. |
| 12 | Keep watching from the other device and lock the host's screen for a minute. | The page keeps updating. |
| 13 | Quit and restart DSH, then open a page again. | The sidebar says Chrome disconnected. The new page opens in a Chrome that is still signed in. |

## Your own Chrome (`dailyProfile.enabled`)

| # | Do | Expect |
|---|---|---|
| 14 | Turn your own Chrome on as the README says, load the connector, and open a page. | Chrome opens it in a window of its own, in a tab group named `DSH` and the start of the session id, showing you signed in. `chrome://extensions` shows the connector without errors. |
| 15 | Minimize the Chrome window. | The sidebar keeps showing the page, updated a few times a second. |
| 16 | Quit and restart DSH while Chrome keeps running. | The connector reconnects; the session's Chrome tab shows the same page, and the agent can still use the page id it had. |
| 17 | Close the page's Chrome tab by hand. | The sidebar says the page was closed. |
| 18 | Press **Cancel** on Chrome's "started debugging this browser" bar. | The sidebar says Chrome stopped sharing the page. |
| 19 | Turn your own Chrome off again and restart DSH. | `~/.config/google-chrome/NativeMessagingHosts/io.github.langify_org.dsh_chrome.json` is gone, unless another DSH wrote its own since. |
