/**
 * The part of noVNC's RFB client that dsh-chrome uses (noVNC ships no types). See
 * node_modules/@novnc/novnc/docs/API.md.
 */
declare module '@novnc/novnc' {
  interface RfbEventMap {
    connect: CustomEvent<Record<string, never>>;
    disconnect: CustomEvent<{ readonly clean: boolean }>;
    clipboard: CustomEvent<{ readonly text: string }>;
    securityfailure: CustomEvent<{ readonly status: number; readonly reason?: string }>;
  }

  export default class RFB {
    /**
     * Connects to a VNC server, through a WebSocket that carries the RFB stream, and draws its
     * screen into an element it adds to the target.
     */
    constructor(target: HTMLElement, channel: WebSocket, options?: { readonly shared?: boolean });
    /** Scale the screen to fit the target, keeping its proportions. */
    scaleViewport: boolean;
    clipViewport: boolean;
    /**
     * The rectangle of the remote screen to show, scaled with scaleViewport, and the only one
     * whose updates are asked for; null shows the whole screen. While it is set, the pointer is
     * kept in it: a drag that leaves the view does not reach another session's monitor.
     * dsh-chrome's patch of noVNC.
     */
    viewRegion: { x: number; y: number; width: number; height: number } | null;
    resizeSession: boolean;
    viewOnly: boolean;
    focusOnClick: boolean;
    showDotCursor: boolean;
    background: string;
    /** 0–9: the JPEG quality the server may use for photographic areas. */
    qualityLevel: number;
    /** 0–9. */
    compressionLevel: number;
    disconnect(): void;
    /** A key press or release, by X keysym; without a `code`, no scancode is sent. */
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    /** Hands the text to the server, which offers it as the screen's clipboard. */
    clipboardPasteFrom(text: string): void;
    blur(): void;
    toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
    addEventListener<E extends keyof RfbEventMap>(
      type: E,
      listener: (event: RfbEventMap[E]) => void,
    ): void;
    removeEventListener<E extends keyof RfbEventMap>(
      type: E,
      listener: (event: RfbEventMap[E]) => void,
    ): void;
  }
}
