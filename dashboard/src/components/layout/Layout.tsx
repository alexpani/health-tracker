import { useState } from "react"
import { Outlet } from "react-router-dom"
import { BookOpen, Menu, X } from "lucide-react"
import Sidebar from "./Sidebar"
import { Button } from "@/components/ui/button"
import { QuickJournalProvider, useQuickJournal } from "@/components/QuickJournalProvider"
import { SyncButton } from "@/components/SyncButton"
import { LastSyncIndicator } from "@/components/LastSyncIndicator"
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock"

function QuickJournalButton() {
  const { openOnToday } = useQuickJournal()
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
      onClick={openOnToday}
      title="Diario di oggi (Cmd/Ctrl+J)"
      aria-label="Apri diario di oggi"
    >
      <BookOpen className="h-4 w-4" />
    </Button>
  )
}

export default function Layout() {
  const [open, setOpen] = useState(false)
  useBodyScrollLock(open)

  return (
    <QuickJournalProvider>
    <div className="flex flex-col h-full bg-slate-100 dark:bg-slate-900">
      {/* Top bar:
          - mobile/tablet (<lg): hamburger + titolo, drawer al click
          - desktop (lg+): nav orizzontale fissa con tutte le voci */}
      <header className="border-b bg-card sticky top-0 z-40 flex items-center gap-3 px-4 h-12">
        {/* Hamburger: solo <lg */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 lg:hidden"
          onClick={() => setOpen(true)}
          aria-label="Menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <a href="/" className="flex items-center gap-2 whitespace-nowrap">
          <img src="/favicon-64.png" alt="Health" className="h-7 w-7 rounded-md" />
          <span className="text-sm font-semibold hidden sm:inline">Health</span>
        </a>

        {/* Nav orizzontale: solo lg+ */}
        <div className="hidden lg:flex flex-1 min-w-0">
          <Sidebar orientation="horizontal" />
        </div>

        {/* Indicatore stato sync + pulsante sincronizza + quick journal */}
        <LastSyncIndicator />
        <SyncButton />
        <QuickJournalButton />
      </header>

      {/* Main content — boxed: max-w 1680px + bg-background + ombra, su
          sfondo esterno bg-slate-100. Padding orizzontale solo su schermi
          larghi così il box "respira" visibilmente. */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain min-w-0">
        <div className="max-w-[1680px] mx-auto px-2 sm:px-4 py-4">
          <div className="bg-background rounded-lg shadow-sm border p-3 sm:p-6 min-h-[calc(100vh-7rem)]">
            <Outlet />
          </div>
        </div>
      </main>

      {/* Drawer navigation (solo <lg) */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-card shadow-xl flex flex-col">
            <div className="h-12 flex items-center justify-between px-4 border-b">
              <span className="text-sm font-semibold">Menu</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
    </QuickJournalProvider>
  )
}
