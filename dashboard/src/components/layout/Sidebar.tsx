import { NavLink } from "react-router-dom"
import {
  Activity as ActivityIcon,
  Apple,
  Compass,
  Dumbbell,
  Heart,
  Home,
  Moon,
  PlusCircle,
  Scale,
  Settings as SettingsIcon,
  Trophy,
  Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/activity", label: "Attivita", icon: ActivityIcon },
  { to: "/vitals", label: "Vitali", icon: Heart },
  { to: "/body", label: "Corpo", icon: Scale },
  { to: "/sleep", label: "Sonno", icon: Moon },
  { to: "/workouts", label: "Workout", icon: Dumbbell },
  { to: "/records", label: "Record", icon: Trophy },
  { to: "/fitness", label: "Fitness", icon: Zap },
  { to: "/nutrition", label: "Nutrizione", icon: Apple },
  { to: "/explore", label: "Esplora", icon: Compass },
  { to: "/insert", label: "Inserisci", icon: PlusCircle },
  { to: "/settings", label: "Impostazioni", icon: SettingsIcon },
]

interface Props {
  onNavigate?: () => void
}

export default function Sidebar({ onNavigate }: Props) {
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
