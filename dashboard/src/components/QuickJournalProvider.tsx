import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { JournalForm } from "@/components/JournalForm"

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
 * pagina, e installa la scorciatoia da tastiera Cmd/Ctrl+J. Apre
 * sempre una NUOVA nota (oggi puoi avere piu' note per lo stesso
 * giorno). */
export function QuickJournalProvider({ children }: { children: React.ReactNode }) {
  const [openDate, setOpenDate] = useState<string | null>(null)

  const openOnDate = useCallback((iso: string) => setOpenDate(iso), [])
  const openOnToday = useCallback(() => setOpenDate(todayLocalISO()), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "j" || e.key === "J")) {
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
      {openDate && (
        <JournalForm
          date={openDate}
          entry={null}
          onClose={() => setOpenDate(null)}
        />
      )}
    </QuickJournalContext.Provider>
  )
}
