// The tab's keyboard. A text box over the screen holds the focus, so the user's
// input method works; noVNC's canvas never takes it. Keys go over VNC through
// noVNC's own translation. Text an input method commits goes to the host,
// which types it into the page: VNC would garble it. Pasted text becomes the
// remote clipboard before the remote sees the V of Ctrl+V.
import type RFB from '@novnc/novnc'
import Keyboard from 'novnc-keyboard'

/** The X keysym of the letter v. */
const XK_V = 0x76

/** Keep from noVNC the keys that are not the remote's; registered first, so it runs first. */
function holdBack(event: KeyboardEvent): void {
  // Keys an input method composes with are its own.
  if (event.isComposing || event.keyCode === 229) {
    event.stopImmediatePropagation()
    return
  }
  // Ctrl+V (Cmd+V): the browser pastes into the box, and the paste handler sends the V.
  if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.code === 'KeyV') {
    event.stopImmediatePropagation()
  }
}

/** Feed `rfb` from `box`; `typeText` receives committed input-method text. Returns the undo. */
export function bridgeInput(
  box: HTMLTextAreaElement,
  rfb: RFB,
  typeText: (text: string) => void,
  composingClass: string,
): () => void {
  box.addEventListener('keydown', holdBack, true)
  box.addEventListener('keyup', holdBack, true)
  const keyboard = new Keyboard(box)
  keyboard.onkeyevent = (keysym, code, down) => rfb.sendKey(keysym, code, down)
  keyboard.grab()

  const start = (): void => box.classList.add(composingClass)
  const end = (event: CompositionEvent): void => {
    box.classList.remove(composingClass)
    if (event.data !== '') typeText(event.data)
    box.value = ''
  }
  // Keys typed straight through also land in the box; keep it empty but for a composition.
  const input = (event: Event): void => {
    if (!(event instanceof InputEvent && event.isComposing)) box.value = ''
  }
  const paste = (event: ClipboardEvent): void => {
    event.preventDefault()
    const text = event.clipboardData?.getData('text/plain') ?? ''
    if (text !== '') rfb.clipboardPasteFrom(text)
    // The held Ctrl went over already; now the V, against the new clipboard.
    rfb.sendKey(XK_V, 'KeyV', true)
    rfb.sendKey(XK_V, 'KeyV', false)
  }
  box.addEventListener('compositionstart', start)
  box.addEventListener('compositionend', end)
  box.addEventListener('input', input)
  box.addEventListener('paste', paste)
  return () => {
    keyboard.ungrab()
    box.removeEventListener('keydown', holdBack, true)
    box.removeEventListener('keyup', holdBack, true)
    box.removeEventListener('compositionstart', start)
    box.removeEventListener('compositionend', end)
    box.removeEventListener('input', input)
    box.removeEventListener('paste', paste)
    box.classList.remove(composingClass)
    box.value = ''
  }
}

/** Put the box where the user pointed, so an input method's candidates show there, and focus it. */
export function focusAt(box: HTMLTextAreaElement, screen: HTMLElement, event: PointerEvent): void {
  const area = screen.getBoundingClientRect()
  box.style.left = `${Math.max(0, Math.min(event.clientX - area.left, area.width - 40))}px`
  box.style.top = `${Math.max(0, Math.min(event.clientY - area.top, area.height - 24))}px`
  box.focus({ preventScroll: true })
}
