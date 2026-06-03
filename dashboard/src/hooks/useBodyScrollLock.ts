import { useEffect } from "react"

/**
 * Blocca lo scroll del body mentre un modale/drawer e' montato (e attivo),
 * ripristinando il valore precedente all'unmount. Reference-counted cosi'
 * modali annidati non si "sbloccano" a vicenda.
 */
let lockCount = 0
let previousOverflow = ""

export function useBodyScrollLock(active: boolean = true) {
  useEffect(() => {
    if (!active) return
    if (lockCount === 0) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = "hidden"
    }
    lockCount += 1
    return () => {
      lockCount -= 1
      if (lockCount === 0) {
        document.body.style.overflow = previousOverflow
      }
    }
  }, [active])
}
