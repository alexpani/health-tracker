import type { LucideIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface Props {
  label: string
  value: string | number
  unit?: string
  icon?: LucideIcon
  color?: string
  subtitle?: string
  loading?: boolean
  /** Se valorizzato, la card diventa un Link cliccabile (con hover state). */
  to?: string
}

export function MetricCard({ label, value, unit, icon: Icon, color = "#3b82f6", subtitle, loading, to }: Props) {
  const card = (
    <Card className={cn(to && "transition-colors hover:bg-accent/40 cursor-pointer")}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            {loading ? (
              <div className="h-8 w-24 bg-muted animate-pulse rounded" />
            ) : (
              <p className="text-2xl font-semibold tracking-tight">
                {value}
                {unit && <span className="text-sm text-muted-foreground font-normal ml-1">{unit}</span>}
              </p>
            )}
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {Icon && (
            <div
              className={cn("p-2 rounded-lg")}
              style={{ backgroundColor: `${color}20`, color }}
            >
              <Icon className="h-5 w-5" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
  if (to) {
    return <Link to={to} className="block">{card}</Link>
  }
  return card
}
