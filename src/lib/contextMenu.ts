/**
 * Suppress the webview's built-in context menu across the whole window.
 *
 * The native menu (Reload, Save as, Inspect, ...) belongs to the browser
 * engine, not to Vesrio. Listening in the capture phase keeps the guard
 * effective even when an editor component stops propagation of its own
 * `contextmenu` handler.
 *
 * @returns a disposer that restores the native menu.
 */
export function suppressNativeContextMenu(target: Window = window): () => void {
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
  }

  target.addEventListener('contextmenu', onContextMenu, { capture: true })
  return () => target.removeEventListener('contextmenu', onContextMenu, { capture: true })
}
