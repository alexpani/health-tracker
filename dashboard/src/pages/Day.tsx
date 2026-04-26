import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  ChevronLeft,
  ChevronRight,
  Activity,
  Dumbbell,
  FlaskConical,
  Heart,
  Apple as AppleIcon,
  Moon,
  Pill,
  Scale,
  Plus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useDaySnapshot } from "@/lib/queries"
import type { DaySnapshot, RegimenKind, Regimen } from "@/lib/types"
import { KIND_LABELS, RegimenForm } from "@/components/RegimenForm"

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`
}

function formatDateIT(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
}

function fmt(n: number | null | undefined, frac = 0): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toLocaleString("it-IT", { maximumFractionDigits: frac })
}

function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—"
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m}'`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${h}h ${mm}'`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
}

export default function Day() {
  const params = useParams()
  const navigate = useNavigate()
  const today = todayLocal()
  const date = params.date ?? today

  // Redirect /day → /day/<oggi>
  useEffect(() => {
    if (!params.date) {
      navigate(`/day/${today}`, { replace: true })
    }
  }, [params.date, today, navigate])

  // Keyboard nav ←/→
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "ArrowLeft") navigate(`/day/${shiftDate(date, -1)}`)
      if (e.key === "ArrowRight") navigate(`/day/${shiftDate(date, 1)}`)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [date, navigate])

  const q = useDaySnapshot(date)
  const data = q.data

  const isFuture = date > today

  const [showAddRegimen, setShowAddRegimen] = useState(false)
  const [editRegimenId, setEditRegimenId] = useState<number | null>(null)
  const editRegimen: Regimen | null = useMemo(() => {
    if (editRegimenId == null || !data) return null
    const r = data.regimens_active.find(x => x.id === editRegimenId)
    if (!r) return null
    return {
      ...r,
      created_at: "",
      updated_at: "",
    }
  }, [editRegimenId, data])

  return (
    <div className="space-y-6">
      {/* Header navigazione */}
      <div className="flex items-center justify-between gap-2 sticky top-0 z-10 bg-background py-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => navigate(`/day/${shiftDate(date, -1)}`)} aria-label="Giorno precedente">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight capitalize px-3">
            {formatDateIT(date)}
          </h1>
          <Button variant="outline" size="icon" onClick={() => navigate(`/day/${shiftDate(date, 1)}`)} aria-label="Giorno successivo">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={date}
            onChange={e => e.target.value && navigate(`/day/${e.target.value}`)}
            className="w-[180px]"
          />
          <Button variant={date === today ? "default" : "outline"} onClick={() => navigate(`/day/${today}`)}>
            Oggi
          </Button>
        </div>
      </div>

      {q.isLoading && !data && <div className="h-72 animate-pulse bg-muted rounded" />}
      {data && (
        <>
          {isFuture && (
            <Card>
              <CardContent className="py-6 text-center text-muted-foreground">
                Giorno futuro: nessun dato disponibile.
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <ActivityCard data={data} />
            <BodyCard data={data} />
            <VitalsCard data={data} />
            <NutritionCard data={data} />
            <SleepCard data={data} />
            <WorkoutsCard data={data} />
            <LabCard data={data} />
            <RegimensCard
              data={data}
              onAdd={() => { setShowAddRegimen(true); setEditRegimenId(null) }}
              onEdit={id => { setEditRegimenId(id); setShowAddRegimen(false) }}
            />
          </div>

          {showAddRegimen && (
            <RegimenForm
              defaults={{ start_date: date }}
              onClose={() => setShowAddRegimen(false)}
            />
          )}
          {editRegimen && (
            <RegimenForm
              regimen={editRegimen}
              onClose={() => setEditRegimenId(null)}
            />
          )}
        </>
      )}
    </div>
  )
}

// ---------- Sub-cards ----------

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex justify-between items-baseline py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">
        {value}
        {sub && <span className="ml-1 text-xs text-muted-foreground">{sub}</span>}
      </span>
    </div>
  )
}

function ActivityCard({ data }: { data: DaySnapshot }) {
  const a = data.activity
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> Attivita'</CardTitle>
      </CardHeader>
      <CardContent>
        <StatRow label="Passi" value={fmt(a.steps)} />
        <StatRow label="Distanza camm./corsa" value={a.distance_walking_running_m != null ? fmt(a.distance_walking_running_m / 1000, 2) : "—"} sub="km" />
        {a.distance_cycling_m != null && a.distance_cycling_m > 0 && (
          <StatRow label="Ciclismo" value={fmt(a.distance_cycling_m / 1000, 2)} sub="km" />
        )}
        {a.distance_swimming_m != null && a.distance_swimming_m > 0 && (
          <StatRow label="Nuoto" value={fmt(a.distance_swimming_m, 0)} sub="m" />
        )}
        <StatRow label="Calorie attive" value={fmt(a.active_kcal)} sub="kcal" />
        <StatRow label="Calorie basali" value={fmt(a.basal_kcal)} sub="kcal" />
        <StatRow label="Tempo esercizio" value={fmt(a.exercise_min)} sub="min" />
        <StatRow label="Stand" value={fmt(a.stand_min)} sub="min" />
        {a.move_min != null && <StatRow label="Move" value={fmt(a.move_min)} sub="min" />}
        <StatRow label="Piani" value={fmt(a.flights)} />
      </CardContent>
    </Card>
  )
}

function BodyCard({ data }: { data: DaySnapshot }) {
  const b = data.body
  const v = (x: { value: number } | null, frac = 1) => x ? fmt(x.value, frac) : "—"
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5" /> Corpo</CardTitle>
      </CardHeader>
      <CardContent>
        <StatRow label="Peso" value={v(b.weight_kg, 2)} sub="kg" />
        <StatRow label="BMI" value={v(b.bmi, 1)} />
        <StatRow label="Grasso" value={b.body_fat_pct ? fmt(b.body_fat_pct.value * 100, 1) : "—"} sub="%" />
        <StatRow label="Massa magra" value={v(b.lean_mass_kg, 2)} sub="kg" />
        <StatRow label="Vita" value={b.waist_m ? fmt(b.waist_m.value * 100, 1) : "—"} sub="cm" />
        <StatRow label="Altezza" value={b.height_m ? fmt(b.height_m.value * 100, 0) : "—"} sub="cm" />
        <p className="text-xs text-muted-foreground mt-2">
          Ultimi valori conosciuti al termine del giorno (potrebbero essere di giorni precedenti).
        </p>
      </CardContent>
    </Card>
  )
}

function VitalsCard({ data }: { data: DaySnapshot }) {
  const v = data.vitals
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Heart className="h-5 w-5" /> Vitali</CardTitle>
      </CardHeader>
      <CardContent>
        <StatRow label="HR media" value={fmt(v.hr_avg, 0)} sub="bpm" />
        <StatRow label="HR min/max" value={`${fmt(v.hr_min, 0)} / ${fmt(v.hr_max, 0)}`} sub="bpm" />
        <StatRow label="HR a riposo" value={fmt(v.resting_hr_avg, 0)} sub="bpm" />
        <StatRow label="HRV (SDNN)" value={fmt(v.hrv_ms_avg, 0)} sub="ms" />
        <StatRow label="SpO₂" value={v.spo2_avg != null ? fmt(v.spo2_avg * 100, 1) : "—"} sub="%" />
        <StatRow label="Pressione" value={v.bp_systolic_avg && v.bp_diastolic_avg ? `${fmt(v.bp_systolic_avg, 0)}/${fmt(v.bp_diastolic_avg, 0)}` : "—"} sub="mmHg" />
        <StatRow label="Respiro" value={fmt(v.respiratory_rate_avg, 1)} sub="/min" />
        <StatRow label="Temperatura" value={fmt(v.temp_c_avg, 1)} sub="°C" />
      </CardContent>
    </Card>
  )
}

function NutritionCard({ data }: { data: DaySnapshot }) {
  const n = data.nutrition
  const Bar = ({ label, value, target, unit }: { label: string; value: number | null; target: number | null; unit: string }) => {
    const pct = value != null && target ? Math.min(100, (value / target) * 100) : 0
    return (
      <div className="py-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular-nums">
            {fmt(value)} <span className="text-xs text-muted-foreground">{unit}</span>
            {target != null && <span className="text-xs text-muted-foreground"> / {fmt(target)}</span>}
          </span>
        </div>
        {target != null && (
          <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    )
  }
  // proteine/grassi/carbo: target dal piano se presente (kcal_target × pct)
  // Per ora niente target sui macro (richiederebbe il piano completo). MVP: solo kcal.
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><AppleIcon className="h-5 w-5" /> Nutrizione</CardTitle>
      </CardHeader>
      <CardContent>
        <Bar label="Calorie" value={n.kcal} target={n.kcal_target} unit="kcal" />
        <Bar label="Proteine" value={n.protein_g} target={null} unit="g" />
        <Bar label="Grassi" value={n.fat_g} target={null} unit="g" />
        <Bar label="Carboidrati" value={n.carbs_g} target={null} unit="g" />
        {(n.water_l != null || n.caffeine_g != null) && (
          <div className="pt-2 mt-2 border-t">
            {n.water_l != null && <StatRow label="Acqua" value={fmt(n.water_l, 2)} sub="L" />}
            {n.caffeine_g != null && <StatRow label="Caffeina" value={fmt(n.caffeine_g * 1000, 0)} sub="mg" />}
            {n.fiber_g != null && <StatRow label="Fibre" value={fmt(n.fiber_g, 1)} sub="g" />}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          {n.diario_present ? "Fonte: diario alimentare" : "Fonte: HealthKit"}
        </p>
      </CardContent>
    </Card>
  )
}

function SleepCard({ data }: { data: DaySnapshot }) {
  const s = data.sleep
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Moon className="h-5 w-5" /> Sonno</CardTitle>
      </CardHeader>
      <CardContent>
        {!s ? (
          <p className="text-sm text-muted-foreground">Nessun dato di sonno per questo giorno.</p>
        ) : (
          <>
            <StatRow label="Dormito" value={fmtDuration((s.asleep_min ?? 0) * 60)} />
            {s.deep_min != null && <StatRow label="Profondo" value={fmtDuration(s.deep_min * 60)} />}
            {s.rem_min != null && <StatRow label="REM" value={fmtDuration(s.rem_min * 60)} />}
            {s.core_min != null && <StatRow label="Core" value={fmtDuration(s.core_min * 60)} />}
            {s.awake_min != null && <StatRow label="Svegliato" value={fmtDuration(s.awake_min * 60)} />}
            <StatRow label="Da → A" value={`${fmtTime(s.start)} → ${fmtTime(s.end)}`} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function WorkoutsCard({ data }: { data: DaySnapshot }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Dumbbell className="h-5 w-5" /> Workout</CardTitle>
      </CardHeader>
      <CardContent>
        {data.workouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun workout registrato.</p>
        ) : (
          <ul className="space-y-2">
            {data.workouts.map(w => (
              <li key={w.uuid}>
                <Link to={`/workouts/${w.uuid}`} className="block hover:bg-accent rounded-md p-2 -mx-2">
                  <div className="flex justify-between items-baseline">
                    <span className="font-medium">{w.title || w.activity_name || "Workout"}</span>
                    <span className="text-xs text-muted-foreground">{fmtTime(w.start_date)}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {fmtDuration(w.duration)}
                    {w.total_distance != null && ` · ${fmt(w.total_distance / 1000, 2)} km`}
                    {w.total_energy_burned != null && ` · ${fmt(w.total_energy_burned, 0)} kcal`}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function LabCard({ data }: { data: DaySnapshot }) {
  if (data.lab_panels.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FlaskConical className="h-5 w-5" /> Laboratorio</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {data.lab_panels.map(p => (
            <li key={p.id}>
              <Link to={`/lab/panels/${p.id}/review`} className="block hover:bg-accent rounded-md p-2 -mx-2">
                <div className="flex justify-between items-baseline">
                  <span className="font-medium">{p.lab_name || `Panel #${p.id}`}</span>
                  <span className="text-xs">
                    {p.status === "confirmed" ? "✓ confermato" : "da rivedere"}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {p.results_count} analiti · {p.specimen_types.join(", ")}
                  {p.out_of_range_count > 0 && (
                    <span className="ml-2 text-destructive">
                      {p.out_of_range_count} fuori range
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function RegimensCard({
  data,
  onAdd,
  onEdit,
}: {
  data: DaySnapshot
  onAdd: () => void
  onEdit: (id: number) => void
}) {
  const grouped: Record<RegimenKind, typeof data.regimens_active> = {
    medication: [],
    supplement: [],
    diet: [],
    training: [],
  }
  for (const r of data.regimens_active) grouped[r.kind].push(r)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Pill className="h-5 w-5" /> Regimi attivi</CardTitle>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-4 w-4 mr-1" /> Aggiungi
        </Button>
      </CardHeader>
      <CardContent>
        {data.regimens_active.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun regime attivo in questo giorno.</p>
        ) : (
          <div className="space-y-3">
            {(Object.keys(grouped) as RegimenKind[]).map(kind => grouped[kind].length > 0 && (
              <div key={kind}>
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{KIND_LABELS[kind]}</p>
                <div className="flex flex-wrap gap-2">
                  {grouped[kind].map(r => {
                    const isDiario = r.source === "diario"
                    const className = "text-sm px-2.5 py-1 rounded-full border bg-secondary " +
                      (isDiario ? "cursor-default" : "hover:bg-accent")
                    const content = (
                      <>
                        {r.name}
                        {r.dose && <span className="ml-1 text-xs text-muted-foreground">{r.dose}</span>}
                        {r.source === "lab_backfill" && <span className="ml-1 text-xs">📑</span>}
                        {isDiario && <span className="ml-1 text-xs" title="Dal diario alimentare">🍽</span>}
                      </>
                    )
                    if (isDiario) {
                      return (
                        <span key={`diario-${r.name}`} className={className}>
                          {content}
                        </span>
                      )
                    }
                    return (
                      <button
                        key={r.id}
                        onClick={() => onEdit(r.id)}
                        className={className}
                      >
                        {content}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
