import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  ChevronLeft,
  ChevronRight,
  Activity,
  CalendarDays,
  Dumbbell,
  FlaskConical,
  Heart,
  Apple as AppleIcon,
  Moon,
  Pill,
  Scale,
  StickyNote,
  Plus,
  BookOpen,
  Pencil,
  StretchHorizontal,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useDaySnapshot, useStretchingSessions } from "@/lib/queries"
import type { DaySnapshot, HealthNote, RegimenKind, Regimen } from "@/lib/types"
import { KIND_LABELS, RegimenForm } from "@/components/RegimenForm"
import { HealthNoteForm } from "@/components/HealthNoteForm"
import { JournalForm } from "@/components/JournalForm"
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock"
import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/healthNotes"
import { DayCalendarSidebar } from "@/components/DayCalendarSidebar"
import { Hypnogram } from "@/components/charts/Hypnogram"
import { SleepScoreCard } from "@/components/charts/SleepScoreCard"
import { RecoveryWidget } from "@/components/RecoveryWidget"

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
  const [showAddNote, setShowAddNote] = useState(false)
  const [editNoteId, setEditNoteId] = useState<number | null>(null)
  /** journalModal: null = chiuso, {entryId: null} = nuova nota,
   * {entryId: N} = edit nota N */
  const [journalModal, setJournalModal] = useState<{ entryId: number | null } | null>(null)
  const [showMobileSidebar, setShowMobileSidebar] = useState(false)
  useBodyScrollLock(showMobileSidebar)
  const editRegimen: Regimen | null = useMemo(() => {
    if (editRegimenId == null || !data) return null
    const r = data.regimens_active.find(x => x.id === editRegimenId)
    if (!r) return null
    return {
      ...r,
      metadata: null,
      created_at: "",
      updated_at: "",
    }
  }, [editRegimenId, data])

  const editNote: HealthNote | null = useMemo(() => {
    if (editNoteId == null || !data) return null
    return data.health_notes.find(n => n.id === editNoteId) ?? null
  }, [editNoteId, data])

  return (
    <div className="flex gap-6 -m-3 sm:-m-6 p-0 min-h-[calc(100vh-0px)]">
      {/* Sidebar desktop a SINISTRA — mini-calendario + (in futuro) altri filtri */}
      <aside className="hidden lg:block w-[300px] shrink-0 border-r bg-card/30 sticky top-0 h-screen overflow-hidden">
        <DayCalendarSidebar selectedDate={date} onSelectDate={iso => navigate(`/day/${iso}`)} />
      </aside>

      <div className="flex-1 space-y-6 min-w-0 p-3 sm:p-6">
        {/* Header navigazione giorno */}
        <div className="flex flex-wrap items-center justify-between gap-2 sticky top-0 z-10 bg-background py-2">
          <div className="flex items-center gap-1 min-w-0">
            <Button variant="outline" size="icon" className="lg:hidden shrink-0" onClick={() => setShowMobileSidebar(true)} aria-label="Calendario">
              <CalendarDays className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="shrink-0" onClick={() => navigate(`/day/${shiftDate(date, -1)}`)} aria-label="Giorno precedente">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-lg sm:text-2xl font-bold tracking-tight capitalize px-2 sm:px-3">
              {formatDateIT(date)}
            </h1>
            <Button variant="outline" size="icon" className="shrink-0" onClick={() => navigate(`/day/${shiftDate(date, 1)}`)} aria-label="Giorno successivo">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Input
              type="date"
              value={date}
              onChange={e => e.target.value && navigate(`/day/${e.target.value}`)}
              className="w-[140px] sm:w-[180px]"
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

            <JournalCard
              data={data}
              onAdd={() => setJournalModal({ entryId: null })}
              onEdit={id => setJournalModal({ entryId: id })}
            />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {date === today && (
                <DayCard icon={Sparkles} title="Recupero" to="/vitals">
                  <RecoveryWidget />
                </DayCard>
              )}
              <ActivityCard data={data} />
              <BodyCard data={data} />
              <VitalsCard data={data} />
              <NutritionCard data={data} />
              <SleepCard data={data} />
              <div className="flex flex-col gap-3">
                <WorkoutsCard data={data} />
                <StretchingCard date={date} />
              </div>
              <LabCard data={data} />
              <RegimensCard
                data={data}
                onAdd={() => { setShowAddRegimen(true); setEditRegimenId(null) }}
                onEdit={id => { setEditRegimenId(id); setShowAddRegimen(false) }}
              />
              <HealthNotesCard
                data={data}
                onAdd={() => { setShowAddNote(true); setEditNoteId(null) }}
                onEdit={id => { setEditNoteId(id); setShowAddNote(false) }}
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
            {showAddNote && (
              <HealthNoteForm
                defaults={{ start_date: date, end_date: date }}
                onClose={() => setShowAddNote(false)}
              />
            )}
            {editNote && (
              <HealthNoteForm
                note={editNote}
                onClose={() => setEditNoteId(null)}
              />
            )}
            {journalModal && (
              <JournalForm
                date={date}
                entry={
                  journalModal.entryId == null
                    ? null
                    : data.journal.find(j => j.id === journalModal.entryId) ?? null
                }
                onClose={() => setJournalModal(null)}
              />
            )}
          </>
        )}
      </div>

      {/* Drawer mobile (<lg) per la sidebar */}
      {showMobileSidebar && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileSidebar(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[85vw] max-w-[300px] bg-card shadow-xl">
            <DayCalendarSidebar
              selectedDate={date}
              onSelectDate={iso => { navigate(`/day/${iso}`); setShowMobileSidebar(false) }}
              onClose={() => setShowMobileSidebar(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Sub-cards ----------

/** Card compatta: header + content con padding ridotto. */
function DayCard({
  icon: Icon,
  title,
  to,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  to?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const titleInner = (
    <>
      <Icon className="h-4 w-4" /> {title}
    </>
  )
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between p-3 pb-1 space-y-0">
        <CardTitle className="text-sm font-semibold">
          {to ? (
            <Link to={to} className="flex items-center gap-1.5 hover:underline">
              {titleInner}
            </Link>
          ) : (
            <span className="flex items-center gap-1.5">{titleInner}</span>
          )}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="p-3 pt-1">
        {children}
      </CardContent>
    </Card>
  )
}

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex justify-between items-baseline py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
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
    <DayCard icon={Activity} title="Attivita'" to="/activity">
      <StatRow label="Passi" value={fmt(a.steps)} />
      <StatRow label="Distanza" value={a.distance_walking_running_m != null ? fmt(a.distance_walking_running_m / 1000, 2) : "—"} sub="km" />
      {a.distance_cycling_m != null && a.distance_cycling_m > 0 && (
        <StatRow label="Ciclismo" value={fmt(a.distance_cycling_m / 1000, 2)} sub="km" />
      )}
      {a.distance_swimming_m != null && a.distance_swimming_m > 0 && (
        <StatRow label="Nuoto" value={fmt(a.distance_swimming_m, 0)} sub="m" />
      )}
      <StatRow label="Cal. attive" value={fmt(a.active_kcal)} sub="kcal" />
      <StatRow label="Cal. basali" value={fmt(a.basal_kcal)} sub="kcal" />
      <StatRow label="Esercizio" value={fmt(a.exercise_min)} sub="min" />
      <StatRow label="Stand" value={fmt(a.stand_min)} sub="min" />
      {a.move_min != null && <StatRow label="Move" value={fmt(a.move_min)} sub="min" />}
      <StatRow label="Piani" value={fmt(a.flights)} />
    </DayCard>
  )
}

function BodyCard({ data }: { data: DaySnapshot }) {
  const b = data.body
  // Misure "lente" (vita): mostrate solo se il sample piu' recente e' entro
  // 30 giorni dal giorno selezionato — un dato di 2 anni fa non e'
  // rappresentativo del giorno.
  const recentEnough = (sample: { start_date: string } | null, days = 30) => {
    if (!sample) return false
    const [y, m, d] = data.date.split("-").map(Number)
    const ref = new Date(y, m - 1, d).getTime()
    const ts = new Date(sample.start_date).getTime()
    return ref - ts <= days * 86_400_000
  }
  const waistOk = recentEnough(b.waist_m)
  const anything =
    b.weight_kg != null || b.bmi != null || b.body_fat_pct != null ||
    b.lean_mass_kg != null || (waistOk && b.waist_m != null)
  return (
    <DayCard icon={Scale} title="Corpo" to="/body">
      {!anything && <p className="text-xs text-muted-foreground">Nessun dato.</p>}
      {b.weight_kg && <StatRow label="Peso" value={fmt(b.weight_kg.value, 2)} sub="kg" />}
      {b.bmi && <StatRow label="BMI" value={fmt(b.bmi.value, 1)} />}
      {b.body_fat_pct && <StatRow label="Grasso" value={fmt(b.body_fat_pct.value * 100, 1)} sub="%" />}
      {b.lean_mass_kg && <StatRow label="Massa magra" value={fmt(b.lean_mass_kg.value, 2)} sub="kg" />}
      {waistOk && b.waist_m && (
        <StatRow label="Vita" value={fmt(b.waist_m.value * 100, 1)} sub="cm" />
      )}
      {anything && (
        <p className="text-[10px] text-muted-foreground mt-1">Ultimi valori al termine del giorno.</p>
      )}
    </DayCard>
  )
}

function VitalsCard({ data }: { data: DaySnapshot }) {
  const v = data.vitals
  const hasHrRange = v.hr_min != null && v.hr_max != null
  const hasBp = v.bp_systolic_avg != null && v.bp_diastolic_avg != null
  const anything =
    v.hr_avg != null || hasHrRange || v.resting_hr_avg != null ||
    v.hrv_ms_avg != null || v.spo2_avg != null || hasBp ||
    v.respiratory_rate_avg != null || v.temp_c_avg != null
  return (
    <DayCard icon={Heart} title="Vitali" to="/vitals">
      {!anything && <p className="text-xs text-muted-foreground">Nessun dato.</p>}
      {v.hr_avg != null && <StatRow label="HR media" value={fmt(v.hr_avg, 0)} sub="bpm" />}
      {hasHrRange && <StatRow label="HR min/max" value={`${fmt(v.hr_min, 0)} / ${fmt(v.hr_max, 0)}`} sub="bpm" />}
      {v.resting_hr_avg != null && <StatRow label="HR riposo" value={fmt(v.resting_hr_avg, 0)} sub="bpm" />}
      {v.hrv_ms_avg != null && <StatRow label="HRV" value={fmt(v.hrv_ms_avg, 0)} sub="ms" />}
      {v.spo2_avg != null && <StatRow label="SpO₂" value={fmt(v.spo2_avg * 100, 1)} sub="%" />}
      {hasBp && <StatRow label="Pressione" value={`${fmt(v.bp_systolic_avg, 0)}/${fmt(v.bp_diastolic_avg, 0)}`} sub="mmHg" />}
      {v.respiratory_rate_avg != null && <StatRow label="Respiro" value={fmt(v.respiratory_rate_avg, 1)} sub="/min" />}
      {v.temp_c_avg != null && <StatRow label="Temperatura" value={fmt(v.temp_c_avg, 1)} sub="°C" />}
    </DayCard>
  )
}

function NutritionCard({ data }: { data: DaySnapshot }) {
  const n = data.nutrition
  const Bar = ({ label, value, target, unit }: { label: string; value: number | null; target: number | null; unit: string }) => {
    const pct = value != null && target ? Math.min(100, (value / target) * 100) : 0
    return (
      <div className="py-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular-nums">
            {fmt(value)}
            {target != null && <span className="text-muted-foreground"> / {fmt(target)}</span>}
            <span className="ml-0.5 text-muted-foreground">{unit}</span>
          </span>
        </div>
        {target != null && (
          <div className="h-1 bg-muted rounded-full overflow-hidden mt-0.5">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    )
  }
  return (
    <DayCard icon={AppleIcon} title="Nutrizione" to="/nutrition">
      <Bar label="Calorie" value={n.kcal} target={n.kcal_target} unit="kcal" />
      <Bar label="Proteine" value={n.protein_g} target={null} unit="g" />
      <Bar label="Grassi" value={n.fat_g} target={null} unit="g" />
      <Bar label="Carboidrati" value={n.carbs_g} target={null} unit="g" />
      {(n.water_l != null || n.caffeine_g != null || n.fiber_g != null) && (
        <div className="pt-1 mt-1 border-t">
          {n.water_l != null && <StatRow label="Acqua" value={fmt(n.water_l, 2)} sub="L" />}
          {n.caffeine_g != null && <StatRow label="Caffeina" value={fmt(n.caffeine_g * 1000, 0)} sub="mg" />}
          {n.fiber_g != null && <StatRow label="Fibre" value={fmt(n.fiber_g, 1)} sub="g" />}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground mt-1">
        {n.diario_present ? "Fonte: diario" : "Fonte: HealthKit"}
      </p>
    </DayCard>
  )
}

function SleepCard({ data }: { data: DaySnapshot }) {
  const s = data.sleep
  return (
    <DayCard icon={Moon} title="Sonno" to="/sleep">
      {!s ? (
        <p className="text-xs text-muted-foreground">Nessun dato.</p>
      ) : (
        <>
          <StatRow label="Dormito" value={fmtDuration((s.asleep_min ?? 0) * 60)} />
          {s.deep_min != null && <StatRow label="Profondo" value={fmtDuration(s.deep_min * 60)} />}
          {s.rem_min != null && <StatRow label="REM" value={fmtDuration(s.rem_min * 60)} />}
          {s.core_min != null && <StatRow label="Principale" value={fmtDuration(s.core_min * 60)} />}
          {s.awake_min != null && <StatRow label="Veglia" value={fmtDuration(s.awake_min * 60)} />}
          <StatRow label="Orario" value={`${fmtTime(s.start)} → ${fmtTime(s.end)}`} />
          <SleepScoreCard date={data.date} compact />
          <Hypnogram date={data.date} />
        </>
      )}
    </DayCard>
  )
}

function WorkoutsCard({ data }: { data: DaySnapshot }) {
  return (
    <DayCard icon={Dumbbell} title="Workout" to="/workouts">
      {data.workouts.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nessun workout.</p>
      ) : (
        <ul className="space-y-1">
          {data.workouts.map(w => (
            <li key={w.uuid}>
              <Link to={`/workouts/${w.uuid}`} className="block hover:bg-accent rounded p-1 -mx-1">
                <div className="flex justify-between items-baseline text-sm">
                  <span className="font-medium truncate">{w.title || w.activity_name || "Workout"}</span>
                  <span className="text-xs text-muted-foreground ml-2 shrink-0">{fmtTime(w.start_date)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {fmtDuration(w.duration)}
                  {w.total_distance != null && ` · ${fmt(w.total_distance / 1000, 2)} km`}
                  {w.total_energy_burned != null && ` · ${fmt(w.total_energy_burned, 0)} kcal`}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DayCard>
  )
}

function StretchingCard({ date }: { date: string }) {
  const q = useStretchingSessions(date, date)
  const sessions = q.data ?? []
  const totalMin = Math.round(sessions.reduce((s, x) => s + (x.duration_sec || 0), 0) / 60)
  return (
    <DayCard icon={StretchHorizontal} title="Stretching" to="/stretching">
      {sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nessuna sessione.</p>
      ) : (
        <>
          <ul className="space-y-1">
            {sessions.map(s => {
              const done = Math.max(0, s.items_total - s.items_skipped)
              return (
                <li key={s.id}>
                  <Link to="/stretching" className="block hover:bg-accent rounded p-1 -mx-1">
                    <div className="flex justify-between items-baseline text-sm">
                      <span className="font-medium truncate">{s.routine_name}</span>
                      <span className="text-xs text-muted-foreground ml-2 shrink-0">{fmtTime(s.started_at)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDuration(s.duration_sec)} · {done}/{s.items_total} esercizi
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
          {sessions.length > 1 && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Totale: {sessions.length} sessioni · {totalMin} min
            </p>
          )}
        </>
      )}
    </DayCard>
  )
}

function LabCard({ data }: { data: DaySnapshot }) {
  if (data.lab_panels.length === 0) return null
  return (
    <DayCard icon={FlaskConical} title="Laboratorio" to="/lab">
      <ul className="space-y-1">
        {data.lab_panels.map(p => (
          <li key={p.id}>
            <Link to={`/lab/panels/${p.id}/review`} className="block hover:bg-accent rounded p-1 -mx-1">
              <div className="flex justify-between items-baseline text-sm">
                <span className="font-medium truncate">{p.lab_name || `Panel #${p.id}`}</span>
                <span className="text-[10px] ml-2 shrink-0">
                  {p.status === "confirmed" ? "✓" : "da rivedere"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {p.results_count} analiti
                {p.out_of_range_count > 0 && (
                  <span className="ml-1 text-destructive">· {p.out_of_range_count} fuori range</span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </DayCard>
  )
}

function JournalCard({
  data,
  onAdd,
  onEdit,
}: {
  data: DaySnapshot
  onAdd: () => void
  onEdit: (id: number) => void
}) {
  const entries = data.journal
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between p-3 pb-1 space-y-0">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <Link to="/journal" className="flex items-center gap-1.5 hover:underline">
            <BookOpen className="h-4 w-4" /> Diario
          </Link>
          {entries.length > 0 && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              ({entries.length} {entries.length === 1 ? "nota" : "note"})
            </span>
          )}
        </CardTitle>
        <Button variant="outline" size="sm" className="h-7 px-2" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Nuova nota
        </Button>
      </CardHeader>
      <CardContent className="p-3 pt-1">
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nessuna nota per questo giorno. Clicca "Nuova nota" per aggiungerne una.
          </p>
        ) : (
          <div className="space-y-3">
            {entries.map(entry => (
              <div
                key={entry.id}
                className="group rounded-md border bg-card/40 p-2.5 space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className="journal-rendered text-sm flex-1 min-w-0"
                    dangerouslySetInnerHTML={{ __html: entry.content_html }}
                  />
                  <button
                    type="button"
                    onClick={() => onEdit(entry.id)}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent shrink-0"
                    title="Modifica"
                    aria-label="Modifica nota"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                {entry.tags && entry.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {entry.tags.map(t => (
                      <span
                        key={t}
                        className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function HealthNotesCard({
  data,
  onAdd,
  onEdit,
}: {
  data: DaySnapshot
  onAdd: () => void
  onEdit: (id: number) => void
}) {
  const grouped: Record<string, HealthNote[]> = {}
  for (const n of data.health_notes) {
    if (!grouped[n.category]) grouped[n.category] = []
    grouped[n.category].push(n)
  }

  return (
    <DayCard
      icon={StickyNote}
      title="Note di salute"
      to="/health-notes"
      action={
        <Button variant="outline" size="sm" className="h-7 px-2" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Aggiungi
        </Button>
      }
    >
      {data.health_notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nessuna nota per questo giorno.</p>
      ) : (
        <div className="space-y-2">
          {CATEGORY_ORDER.map(cat => grouped[cat] && grouped[cat].length > 0 && (
            <div key={cat}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5 flex items-center gap-1">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${CATEGORY_COLORS[cat as keyof typeof CATEGORY_COLORS].dot}`} />
                {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS]}
              </p>
              <ul className="space-y-1">
                {grouped[cat].map(n => {
                  const isPeriod = n.start_date !== n.end_date
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => onEdit(n.id)}
                        className="w-full text-left text-xs px-2 py-1 rounded border bg-secondary/50 hover:bg-accent"
                      >
                        {n.body_zone && <span className="font-medium">{n.body_zone}: </span>}
                        <span>{n.text}</span>
                        {isPeriod && (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            ({fmtDateShort(n.start_date)} → {fmtDateShort(n.end_date)})
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </DayCard>
  )
}

function fmtDateShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${String(y).slice(2)}`
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
    gear: [],
  }
  // Gear (es. scarpe da corsa) non e' un "regime attivo" del giorno: ha
  // senso solo nella timeline di /regimens.
  for (const r of data.regimens_active) {
    if (r.kind === "gear") continue
    grouped[r.kind].push(r)
  }

  return (
    <DayCard
      icon={Pill}
      title="Regimi attivi"
      to="/regimens"
      action={
        <Button variant="outline" size="sm" className="h-7 px-2" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Aggiungi
        </Button>
      }
    >
      {data.regimens_active.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nessun regime attivo.</p>
      ) : (
        <div className="space-y-2">
          {(Object.keys(grouped) as RegimenKind[]).map(kind => grouped[kind].length > 0 && (
            <div key={kind}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">{KIND_LABELS[kind]}</p>
              <div className="flex flex-wrap gap-1.5">
                {grouped[kind].map(r => {
                  const isDiario = r.source === "diario"
                  const className = "text-xs px-2 py-0.5 rounded-full border bg-secondary " +
                    (isDiario ? "cursor-default" : "hover:bg-accent")
                  const content = (
                    <>
                      {r.name}
                      {r.dose && <span className="ml-1 text-muted-foreground">{r.dose}</span>}
                      {r.source === "lab_backfill" && <span className="ml-1">📑</span>}
                      {isDiario && <span className="ml-1" title="Dal diario alimentare">🍽</span>}
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
    </DayCard>
  )
}
