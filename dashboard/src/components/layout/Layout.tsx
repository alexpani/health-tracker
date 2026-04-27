import { useState } from "react"
import { Outlet } from "react-router-dom"
import { Menu, X } from "lucide-react"
import Sidebar from "./Sidebar"
import { Button } from "@/components/ui/button"

export default function Layout() {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-col h-full">
      {/* Top bar:
          - mobile/tablet (<lg): hamburger + titolo, drawer al click
          - desktop (lg+): nav orizzontale fissa con tutte le voci */}
      <header className="border-b bg-card/50 sticky top-0 z-40 flex items-center gap-3 px-4 h-12">
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
        <span className="text-sm font-semibold whitespace-nowrap">Health Dashboard</span>

        {/* Nav orizzontale: solo lg+ */}
        <div className="hidden lg:flex flex-1 min-w-0">
          <Sidebar orientation="horizontal" />
        </div>
      </header>

      {/* Main content full-width */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6">
          <Outlet />
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
  )
}
