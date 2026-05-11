import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { useJournalDays } from "@/lib/queries"

interface Props {
  year: number
}

function pad2(n: number) { return n.toString().padStart(2, "0") }
function iso(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }

const MONTH_LABELS_IT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"]

/** Heatmap stile GitHub: 7 righe (lun-dom) x ~53 colonne (settimane).
 * Verde se il giorno ha una voce diario; grigio chiaro altrimenti.
 * Click su una cella → naviga al /day/<iso>.
 */
export function JournalHeatmap({ year }: Props) {
  const navigate = useNavigate()
  const start = `${year}-01-01`
  const end = `${year}-12-31`
  const { data: days } = useJournalDays(start, end)

  const daysSet = useMemo(() => new Set(days ?? []), [days])

  const grid = useMemo(() => {
    // Build all dates in year, group into ISO weeks columns (Monday start).
    const cells: { iso: string; day: number; month: number; weekday: number; col: number }[] = []
    const jan1 = new Date(year, 0, 1)
    // weekday 0=Mon..6=Sun
    const firstWeekday = (jan1.getDay() + 6) % 7
    let col = 0
    let curWeekday = firstWeekday
    const last = new Date(year, 11, 31)
    for (let d = new Date(year, 0, 1); d <= last; d.setDate(d.getDate() + 1)) {
      cells.push({
        iso: iso(d),
        day: d.getDate(),
        month: d.getMonth(),
        weekday: curWeekday,
        col,
      })
      curWeekday = (curWeekday + 1) % 7
      if (curWeekday === 0) col++
    }
    const totalCols = col + 1
    return { cells, totalCols }
  }, [year])

  // X positions of first day of each month (for top labels)
  const monthCols = useMemo(() => {
    const out: { month: number; col: number }[] = []
    for (const c of grid.cells) {
      if (c.day === 1) out.push({ month: c.month, col: c.col })
    }
    return out
  }, [grid])

  const CELL = 11
  const GAP = 2
  const TOP = 14
  const LEFT = 22
  const width = LEFT + grid.totalCols * (CELL + GAP)
  const height = TOP + 7 * (CELL + GAP)

  const totalWithEntries = useMemo(() => {
    let n = 0
    for (const c of grid.cells) if (daysSet.has(c.iso)) n++
    return n
  }, [grid, daysSet])

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{totalWithEntries} {totalWithEntries === 1 ? "voce" : "voci"} nel {year}</span>
        <span className="flex items-center gap-1">
          Meno
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-muted" />
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-indigo-500" />
          Più
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg width={width} height={height} className="text-[10px]">
          {/* Month labels */}
          {monthCols.map(m => (
            <text
              key={m.month}
              x={LEFT + m.col * (CELL + GAP)}
              y={10}
              className="fill-muted-foreground"
            >
              {MONTH_LABELS_IT[m.month]}
            </text>
          ))}
          {/* Weekday labels */}
          {[0, 2, 4].map(wd => (
            <text key={wd} x={0} y={TOP + wd * (CELL + GAP) + 9} className="fill-muted-foreground">
              {["L", "M", "M", "G", "V", "S", "D"][wd]}
            </text>
          ))}
          {/* Cells */}
          {grid.cells.map(c => {
            const has = daysSet.has(c.iso)
            return (
              <rect
                key={c.iso}
                x={LEFT + c.col * (CELL + GAP)}
                y={TOP + c.weekday * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2}
                className={has ? "fill-indigo-500 cursor-pointer hover:fill-indigo-400" : "fill-muted hover:fill-accent cursor-pointer"}
                onClick={() => navigate(`/day/${c.iso}`)}
              >
                <title>{c.iso}{has ? " · voce" : ""}</title>
              </rect>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
