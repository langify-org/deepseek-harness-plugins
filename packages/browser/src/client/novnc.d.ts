// Types for the parts of noVNC the tab uses, which publishes none: its RFB
// class, the package's only export, and its keyboard translation, reached
// through the alias in tsdown.config.ts.

declare module '@novnc/novnc' {
  export interface RFBOptions {
    readonly shared?: boolean
  }

  /** A VNC connection drawn into `target`; events: connect, disconnect, clipboard. */
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, channel: string | WebSocket, options?: RFBOptions)
    /** Scale the remote screen to fit the target. */
    scaleViewport: boolean
    /** Ask the server to resize its screen to the target. */
    resizeSession: boolean
    /** Focus the canvas when it is clicked. */
    focusOnClick: boolean
    background: string
    disconnect(): void
    /** Send one key event; `down` omitted sends a press and a release. */
    sendKey(keysym: number, code: string | null, down?: boolean): void
    /** Set the server's clipboard. */
    clipboardPasteFrom(text: string): void
  }
}

declare module 'novnc-keyboard' {
  /** Translates key events on `target` into X keysyms. */
  export default class Keyboard {
    constructor(target: HTMLElement)
    onkeyevent: (keysym: number, code: string, down: boolean) => void
    grab(): void
    ungrab(): void
  }
}
