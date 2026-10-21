# Acceptance checks

What the automated tests cannot reach: the user's own Chrome profile and its extensions,
DSH's real web client, and devices other than the host. Run these by hand before a release,
on DSH Desktop with the plugin installed as the README describes.

The tests already cover the rest against a real Chrome in temporary profiles: the
connector, page actions, the agent's tools, frames and layout, input including composed
text, help requests, adding a page to a message, and a host restart
(`pnpm test:integration`).

| # | Do | Expect |
|---|---|---|
| 1 | Start DSH with the plugin, with Chrome running and the connector loaded. | DSH's log: `dsh-chrome: … connected (daily profile, connector <version>)`. `chrome://extensions` shows the connector without errors. |
| 2 | Open **Chrome** from the right sidebar's new-tab guide and enter a site you are signed in to. | Chrome opens it in a window of its own, in a tab group named `DSH` and the start of the session id, showing you signed in. The sidebar shows the same page at the sidebar's size. |
| 3 | Resize the sidebar, then click, scroll and type in the page. Type Japanese with your input method. | The page relays out to the new size. Input lands where you point; the composition shows at the bottom of the sidebar and only the finished text reaches the page. |
| 4 | On a login form, use 1Password's in-page autofill. | The autofill menu appears in the sidebar and fills the form. (Its toolbar popup opens only in the Chrome window.) |
| 5 | Ask the agent to open a page and summarize it. | The tab switches to the agent's page; the agent uses `chrome_open` and `chrome_snapshot`. |
| 6 | Ask the agent to do something that needs a sign-in it does not have. | It calls `chrome_ask_user`; the request appears above the page; **Done** lets it continue. |
| 7 | Press 📷 and 📄 in the toolbar. | A screenshot and the page's text are attached to your next message. |
| 8 | Minimize the Chrome window. | The sidebar keeps showing the page, updated a few times a second. |
| 9 | Open DSH from another device (a phone on the tailnet) and open the same session's Chrome tab. | The page appears, laid out for the device that last touched it; taps click, drags scroll, ⌨ raises the keyboard. |
| 10 | Keep watching from the other device and lock the host's screen for a minute. | The page keeps updating, at least once a second. |
| 11 | Quit and restart DSH while Chrome keeps running. | The connector reconnects; the session's Chrome tab shows the same page, and the agent can still use the page id it had. |
| 12 | Close the page's Chrome tab by hand. | The sidebar says the page was closed. |
| 13 | Press **Cancel** on Chrome's "started debugging this browser" bar. | The sidebar says Chrome stopped sharing the page. |
