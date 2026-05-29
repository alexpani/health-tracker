"""Risorse MCP statiche — contesto sempre disponibile al modello.

Usate per dare a Claude il "manuale" del progetto senza dover essere chieste.
"""
from __future__ import annotations

from . import metrics as metrics_mod
from .tools.snapshots import get_health_profile


async def resource_profile() -> str:
    """profile://me — anagrafica + baselines (peso/RHR/HRV recenti)."""
    p = await get_health_profile()
    lines = ["# Profilo utente", ""]
    if "name" in p:
        lines.append(f"- Nome: {p['name']}")
    if "birthdate" in p:
        lines.append(f"- Data nascita: {p['birthdate']} (eta' {p.get('age', '?')})")
    if "height_m" in p:
        lines.append(f"- Altezza: {p['height_m']:.2f} m")
    if "last_weight_kg" in p:
        lines.append(f"- Peso recente: {p['last_weight_kg']:.1f} kg ({p.get('last_weight_at', '')})")
    if "bmi" in p:
        lines.append(f"- BMI: {p['bmi']}")
    if "last_body_fat_pct" in p:
        lines.append(f"- Body fat: {p['last_body_fat_pct']}%")
    if "rhr_baseline_60d" in p:
        lines.append(f"- RHR baseline 60g: {p['rhr_baseline_60d']} bpm (n={p.get('rhr_baseline_n', 0)})")
    if "hrv_baseline_60d_ms" in p:
        lines.append(f"- HRV baseline 60g: {p['hrv_baseline_60d_ms']} ms")

    regs = p.get("active_regimens") or []
    if regs:
        lines.append("")
        lines.append("## Regimi attivi oggi")
        for r in regs:
            dose = f" ({r['dose']})" if r.get("dose") else ""
            lines.append(f"- [{r['kind']}] {r['name']}{dose}")
    return "\n".join(lines)


def resource_metrics_catalog() -> str:
    """metrics://catalog — lista delle metriche aggregabili."""
    by_cat = metrics_mod.by_category()
    lines = ["# Catalogo metriche disponibili per i tool analitici", ""]
    lines.append(
        "Usate da `aggregate`, `compare_periods`, `correlate`, `find_periods` e "
        "`life_timeline`. Per altre metriche non in lista usa `query_sql` diretto.\n"
    )
    for cat, items in by_cat.items():
        lines.append(f"## {cat}")
        for m in items:
            unit = f" [{m.unit}]" if m.unit else ""
            desc = f" — {m.description}" if m.description else ""
            lines.append(f"- `{m.slug}`{unit}{desc}")
        lines.append("")
    return "\n".join(lines)


def resource_glossary() -> str:
    """glossary://project — convenzioni semantiche del progetto."""
    return """# Glossario Health Tracker

Convenzioni e gotcha da conoscere per scrivere SQL/tool corretti.

## Schema principali

- **health_samples** — quantity samples (peso, HR, passi raw, ecc.). Discriminatore `type` (formato `HKQuantityTypeIdentifier*`). `start_date` timestamptz.
- **category_samples** — category samples (sonno, stand hour). `value` enum integer.
- **workouts** — uno per workout. `activity_type` int HKWorkoutActivityType. `total_distance` METRI. `duration` SECONDI. `total_energy_burned` kcal. **`activities` JSONB** = array di segmenti/intervalli interni (Intervals Pro, Apple Workout custom, Strava intervals, ecc.) — ogni elemento ha `{kind, n, start, end, duration_s, distance_m, pace_s_per_km, avg_hr, max_hr, kcal}`. `jsonb_array_length(activities) > 1` distingue workout strutturati da continui. Per dettaglio interno usa il tool `get_workout_intervals(uuid)`; per elenco filtrato `list_recent_workouts`. **`metadata` JSONB** contiene `HKIndoorWorkout`, `HKSwimmingLocationType`, `HKLapLength`, METs, weather, brand. Field user-editable: `title`, `notes`.
- **daily_stats** — totali giornalieri pre-aggregati (Steps, Distance{WR,Cyc,Swim}, Energy{Active,Basal}, AppleExerciseTime, Flights, ApplStandTime/MoveTime). UNIQUE su `(type, date, COALESCE(source, '_all_'))`. Per i totali aggregati cross-source usa `source IS NULL`. Questi numeri combaciano coi widget Apple Salute (dedup HK proprietario Watch+iPhone).
- **regimens** — periodi farmaci/integratori/dieta/training/gear. `kind ∈ {medication, supplement, diet, training, gear}`. `start_date` NULL = "iniziato prima del tracking". `end_date` NULL = "in corso".
- **lab_panels / lab_results / lab_analytes** — referti laboratorio. Filtra SEMPRE `lab_panels.status = 'confirmed'` per dati affidabili. `lab_results.value_numeric` per numerici, `value_text` per qualitativi. `lab_analytes.slug` chiave canonica (es. 'ldl_cholesterol').
- **journal_entries** — diario libero (rich text). N voci per giorno. `search_tsv` per FTS italiano.
- **health_notes** — note salute (dolore/malattia/sintomi). Periodo chiuso `[start_date, end_date]` (anche di un solo giorno).

## HKWorkoutActivityType — codici più comuni

| Codice | Attività |
|---|---|
| 37 | Running (outdoor + indoor con HKIndoorWorkout=1 in metadata) |
| 52 | Walking |
| 13 | Cycling (indoor con HKIndoorWorkout=1 in metadata) |
| 46 | Swimming (HKSwimmingLocationType=1 pool, 2 open water) |
| 50 | Traditional Strength Training |
| 16 | Elliptical |
| 35 | Rowing |
| 3000 | Other |

## "Effective type" slug (derivato)

- `treadmill_run` = activity_type=37 + HKIndoorWorkout=1
- `treadmill_walk` = 52 + indoor
- `cyclette` = 13 + indoor
- `swim_pool` = 46 + HKSwimmingLocationType=1
- `swim_open_water` = 46 + HKSwimmingLocationType=2
- `type_XXX` = activity_type=XXX puro

## Gotcha

- I sample HK hanno `start_date` ≠ `created_at`: il Watch scrive RHR/temp/VO2Max retroattivamente con startDate notturno ma creationDate del mattino. NON filtrare per "ultimi N giorni di sample" assumendo che siano sincronizzati: meglio interrogare `start_date >= NOW() - INTERVAL 'N days'`.
- **Body fat** è memorizzato come 0-1 (frazione), non percentuale. Moltiplica ×100 per il display.
- **Workout total_distance** è in METRI, `duration` in SECONDI.
- Ritmo s/km = `duration / (total_distance / 1000)`. Pace inferiore = più veloce.
- I record con `total_distance=0` o `duration=0` sono spesso outlier (workout aborted), filtrali se calcoli medie.
- `regimens` con `source='lab_backfill'` sono generati automaticamente dai panel lab confermati. `source='training_autodetect'` sono fasce di training dedotte dai workout (cron notturno).
- I `lab_panels` in `status='draft'` sono in attesa di review umana — escludili dalle analisi storiche.
- `daily_stats.value` con `source IS NULL` = totale cross-source (dedup HK). Per source-specific c'è una row per ciascuna source.
- **Sleep**: gli stage HK sono `value` numerico — 1=InBed, 2=Awake, 3=Core, 4=Deep, 5=REM, 0=Asleep(legacy). Per la durata effettiva di sonno usa value IN (3,4,5).

## Date e timezone

- Tutto è TIMESTAMPTZ. Le date locali (Europe/Rome) sono di solito quelle che l'utente "vede". Per bucket giornalieri usa `date_trunc('day', start_date AT TIME ZONE 'Europe/Rome')` se serve precisione mezzanotte locale; il default `date_trunc('day', start_date)` opera in UTC.
- Per i lab `test_date` è una `date` (no time), niente conversione.

## Tools

- `aggregate(metric, bucket, agg)` — la prima cosa da provare per qualunque "andamento".
- `compare_periods` — confronto strutturato fra range temporali arbitrari.
- `correlate` — matrice di correlazione fra N metriche su bucket allineati.
- `find_periods` — trova range in cui una metrica soddisfa una condizione.
- `life_timeline` — overview compatta una-riga-per-bucket con tutte le metriche salienti.
- `get_workout_intervals(uuid)` — segmenti interni di un singolo workout (Intervals Pro → ripetute, recuperi).
- `list_recent_workouts` — elenco workout filtrato con flag `has_intervals` per scegliere quali approfondire.
- `query_sql` — fallback per qualsiasi cosa non coperta dai precedenti.

## Classificazione segmenti corsa/cammino

Quando leggi `activities` di un workout di corsa, le soglie euristiche per
distinguere segmenti corsa da camminata sono basate sul `pace_s_per_km` medio
del segmento:

- `pace_s_per_km <= 480` (≤ 8 min/km) → **corsa** ("run")
- `pace_s_per_km >= 600` (≥ 10 min/km) → **camminata** ("walk")
- `480 < pace_s_per_km < 600` → **transizione/mixed**
- `pace_s_per_km` mancante o ≤ 0 → **unknown**

Queste soglie sono usate dal tool `get_workout_intervals` e dalle metriche
`workout.running.walk_share_pct` e `workout.running.run_avg_pace_in_intervals`.
"""
