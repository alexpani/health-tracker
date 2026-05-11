import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { JournalForm } from "@/components/JournalForm"
import { useJournalEntry } from "@/lib/queries"

interface QuickJournalContextValue {
  openOnDate: (iso: string) => void
  openOnToday: () => void
}

const QuickJournalContext = createContext<QuickJournalContextValue | null>(null)

export function useQuickJournal() {
  const ctx = useContext(QuickJournalContext)
  if (!ctx) throw new Error("useQuickJournal must be used inside QuickJournalProvider")
  return ctx
}

function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Provider che abilita l'apertura del modal del diario da qualsiasi
 * pagina, e installa la scorciatoia da tastiera Cmd/Ctrl+J. */
export function QuickJournalProvider({ children }: { children: React.ReactNode }) {
  const [openDate, setOpenDate] = useState<string | null>(null)

  const openOnDate = useCallback((iso: string) => setOpenDate(iso), [])
  const openOnToday = useCallback(() => setOpenDate(todayLocalISO()), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd+J su Mac, Ctrl+J su Windows/Linux
      if ((e.metaKey || e.ctrlKey) && (e.key === "j" || e.key === "J")) {
        // Evita conflitto col downloads di Chrome (usa anche Cmd+J).
        // L'utente in self-host con use intenso accettera' lo stop default.
        e.preventDefault()
        openOnToday()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [openOnToday])

  return (
    <QuickJournalContext.Provider value={{ openOnDate, openOnToday }}>
      {children}
      {openDate && <QuickModal date={openDate} onClose={() => setOpenDate(null)} />}
    </QuickJournalContext.Provider>
  )
}

/** Wrapper che fa il fetch dell'entry corrente (se esiste) e passa il
 * risultato a JournalForm. */
function QuickModal({ date, onClose }: { date: string; onClose: () => void }) {
  const q = useJournalEntry(date)
  if (q.isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
        <div className="bg-card rounded-lg p-6 shadow-2xl">Caricamento…</div>
      </div>
    )
  }
  return <JournalForm date={date} entry={q.data ?? null} onClose={onClose} />
}
