import { NavLink } from "react-router-dom"
import {
  Activity as ActivityIcon,
  Apple,
  BookOpen,
  CalendarDays,
  Compass,
  Dumbbell,
  FlaskConical,
  Heart,
  Home,
  Moon,
  Pill,
  PlusCircle,
  Scale,
  Settings as SettingsIcon,
  Stethoscope,
  StickyNote,
  StretchHorizontal,
  Trophy,

  Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/day", label: "Calendario", icon: CalendarDays },
  { to: "/journal", label: "Diario", icon: BookOpen },
  { to: "/health-notes", label: "Note salute", icon: StickyNote },
  { to: "/workouts", label: "Workout", icon: Dumbbell },
  { to: "/body", label: "Corpo", icon: Scale },
  { to: "/nutrition", label: "Nutrizione", icon: Apple },
  { to: "/stretching", label: "Stretching", icon: StretchHorizontal },
  { to: "/sleep", label: "Sonno", icon: Moon },
  { to: "/regimens", label: "Regimi", icon: Pill },
  { to: "/lab", label: "Laboratorio", icon: FlaskConical },
  // Cartelle cliniche (HealthKit Clinical Records / FHIR): nascosta finche'
  // l'autorizzazione lato iPhone non sara' operativa. Codice (page, queries,
  // backend models/routers, iOS sync) resta in piedi — basta ripristinare
  // questa riga + la route in App.tsx per riattivare.
  // { to: "/clinical", label: "Cartelle cliniche", icon: Stethoscope },
  { to: "/activity", label: "Attivita", icon: ActivityIcon },
  { to: "/vitals", label: "Vitali", icon: Heart },
  { to: "/records", label: "Record", icon: Trophy },
  { to: "/fitness", label: "Fitness", icon: Zap },
  { to: "/explore", label: "Esplora", icon: Compass },
  { to: "/insert", label: "Inserisci", icon: PlusCircle },
  { to: "/settings", label: "Impostazioni", icon: SettingsIcon },
]

interface Props {
  onNavigate?: () => void
  orientation?: "vertical" | "horizontal"
}

export default function Sidebar({ onNavigate, orientation = "vertical" }: Props) {
  if (orientation === "horizontal") {
    // Top bar nav: scrolla orizzontalmente sopra a 16 voci, niente wrap.
    return (
      <nav className="flex-1 overflow-x-auto">
        <ul className="flex items-center gap-0.5 px-2 h-full">
          {navItems.map(item => (
            <li key={item.to} className="shrink-0">
              <NavLink
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    )
  }

  return (
    <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
      {navItems.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )
          }
        >
          <item.icon className="h-4 w-4" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
