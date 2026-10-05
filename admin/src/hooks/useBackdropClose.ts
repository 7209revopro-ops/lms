import { useCallback, useRef } from 'react'

/**
 * Guards a modal backdrop against closing on a gesture that only ENDS on the
 * backdrop — scrolling a `<select>`, dragging a date picker, or selecting
 * text that starts inside the modal's content but releases outside it (easy
 * with touch, and in a narrow/split-screen viewport) must not read as "the
 * user clicked outside". A plain `onClick={onClose}` on the backdrop closes
 * on every one of those, because a click fires at the pointer-UP location,
 * not where the gesture started.
 *
 * Only a press AND a click that both land on the backdrop element itself
 * (never inside the content) close the modal. Spread the result onto the
 * backdrop div; the content div still needs its own `onClick={e =>
 * e.stopPropagation()}` so a click that both starts and ends inside it never
 * reaches here at all.
 */
export function useBackdropClose(onClose: () => void) {
  const startedOnBackdrop = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    startedOnBackdrop.current = e.target === e.currentTarget
  }, [])

  const onClick = useCallback((e: React.MouseEvent) => {
    if (startedOnBackdrop.current && e.target === e.currentTarget) onClose()
    startedOnBackdrop.current = false
  }, [onClose])

  return { onMouseDown, onClick }
}
