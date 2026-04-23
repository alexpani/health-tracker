# Health Tracker — Modulo Lab Results (sangue + urine)

Spec di implementazione per Claude Code.
Branch: `feature/lab-results`.

---

## 1. Contesto

Il repo `alexpani/health-tracker` è un bridge Apple Health ↔ web app con:
- **Backend**: FastAPI + async SQLAlchemy + PostgreSQL 16 + Alembic (Dockerizzato).
- **Dashboard**: React 18 + Vite + TS + Tailwind + shadcn/ui + Recharts + TanStack Query.
- **iOS**: SwiftUI, lato HealthKit.

Oggi il dominio è interamente HealthKit-centrico (`health_samples`, `workouts`, `sync_log`, write/delete queue). Il peso vive già lì.

Vogliamo aggiungere un **nuovo dominio separato**: referti di laboratorio (analisi sangue e urine), con ingest da PDF testuali, review umana, persistenza normalizzata e pagina dashboard dedicata. **Nessuna fusione con `health_samples`**: è un dominio diverso per natura, unità, range e frequenza.

## 2. Obiettivi

1. Caricare un PDF testuale di referto → estrazione automatica dei valori → review → commit in DB.
2. Replicare e superare lo spreadsheet attualmente usato (matrice analiti × date) con vista chart multi-serie, range di riferimento in banda, evidenziazione fuori range.
3. Importare lo storico dal foglio esistente (formato: righe = analiti, colonne = date).
4. Gestire sia analiti **quantitativi** (es. TSH = 1.21 µIU/ml) sia **qualitativi/semi-quantitativi** tipici delle urine (es. "assente", "tracce", "++").
5. Nessuna scrittura verso Apple Health. Il peso dal referto va cross-referenziato in sola lettura col sample HK più vicino, non duplicato.

## 3. Out of scope (per questa PR)

- OCR (i PDF sono testuali).
- Push verso Apple Health dei valori lab.
- Multi-utente / auth (rimane single-user come il resto).
- Notifiche / alert automatici.
- Parser template-based specifici per laboratorio (vedi §11 — possibile evoluzione futura).

---

## 4. Modello dati

### 4.1 Nuove tabelle

```sql
-- Catalogo analiti normalizzati
CREATE TABLE lab_analytes (
    id              SERIAL PRIMARY KEY,
    slug            TEXT UNIQUE NOT NULL,           -- es. 'psa_total', 'tsh', 'urine_ph'
    display_name_it TEXT NOT NULL,                  -- es. 'PSA totale', 'TSH', 'pH urine'
    category        TEXT NOT NULL,                  -- 'ormoni' | 'fegato' | 'reni' | 'vitamine' | 'urine' | ...
    specimen        TEXT NOT NULL DEFAULT 'blood',  -- 'blood' | 'urine' | 'other'
    value_type      TEXT NOT NULL DEFAULT 'numeric',-- 'numeric' | 'semi_quantitative' | 'qualitative' | 'textual'
    unit_canonical  TEXT,                           -- NULL se qualitativo
    ref_low         NUMERIC,
    ref_high        NUMERIC,
    ref_text        TEXT,                           -- es. 'assente', 'negativo' per qualitativi
    sex_specific    TEXT,                           -- NULL | 'M' | 'F'
    loinc_code      TEXT,                           -- opzionale
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Alias per matching nomi variabili tra referti
CREATE TABLE lab_analyte_aliases (
    id          SERIAL PRIMARY KEY,
    analyte_id  INTEGER NOT NULL REFERENCES lab_analytes(id) ON DELETE CASCADE,
    alias       TEXT NOT NULL,                      -- es. 'PSA tot.', 'PSA totale', 'Antigene prostatico sp. tot.'
    UNIQUE (alias)
);
CREATE INDEX ix_lab_aliases_lower ON lab_analyte_aliases (LOWER(alias));

-- Referto (un PDF = un panel)
CREATE TABLE lab_panels (
    id              SERIAL PRIMARY KEY,
    test_date       DATE NOT NULL,
    lab_name        TEXT,
    specimen_types  TEXT[] NOT NULL DEFAULT '{}',   -- ['blood'], ['urine'], ['blood','urine']
    document_id     INTEGER REFERENCES lab_documents(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'confirmed'
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at    TIMESTAMPTZ
);
CREATE INDEX ix_lab_panels_date ON lab_panels (test_date DESC);

-- Valori misurati
CREATE TABLE lab_results (
    id              SERIAL PRIMARY KEY,
    panel_id        INTEGER NOT NULL REFERENCES lab_panels(id) ON DELETE CASCADE,
    analyte_id      INTEGER REFERENCES lab_analytes(id) ON DELETE SET NULL,
    raw_name        TEXT NOT NULL,                  -- il nome esatto come letto dal PDF (utile per apprendimento alias)
    value_numeric   NUMERIC,
    value_text      TEXT,
    unit_raw        TEXT,
    unit_normalized TEXT,                           -- dopo conversione verso unit_canonical
    ref_low_raw     NUMERIC,
    ref_high_raw    NUMERIC,
    ref_text_raw    TEXT,
    out_of_range    BOOLEAN,                        -- computed at commit
    needs_review    BOOLEAN NOT NULL DEFAULT TRUE,  -- true finché review non conferma matching
    notes           TEXT
);
CREATE INDEX ix_lab_results_panel ON lab_results (panel_id);
CREATE INDEX ix_lab_results_analyte ON lab_results (analyte_id);

-- File originali
CREATE TABLE lab_documents (
    id            SERIAL PRIMARY KEY,
    relative_path TEXT NOT NULL,                    -- path relativo al volume backend/data/lab_documents/
    sha256        TEXT NOT NULL UNIQUE,
    mime_type     TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL,
    uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Note:**
- `lab_documents.relative_path` punta dentro un volume Docker dedicato (`./data/lab_documents` mappato nel compose). Non mettere PDF in repo — aggiungere a `.gitignore`.
- `out_of_range` si computa al commit leggendo i range dell'analita (fallback sui range raw se l'analita non è ancora nel catalogo).
- FK circolare `lab_panels.document_id → lab_documents.id` risolta con migrazione che crea prima le tabelle senza FK poi aggiunge.

### 4.2 Seed catalogo

Migration Alembic separata `seed_lab_analytes.py` con almeno i parametri già presenti nello spreadsheet dell'utente più il pannello urine standard. Template di massima:

**Sangue** — `lh`, `prolactin`, `ft3`, `ft4`, `tsh`, `vit_b12`, `psa_total`, `psa_free`, `folate`, `homocysteine`, `urea` (azotemia), `creatinine`, `ast`, `alt`, `ggt`, `ck`, `uric_acid`, `total_bilirubin`, `ferritin`, `esr` (VES), `q10`, `alpha_lipoic_acid`, `vit_d_25oh`, `vit_d3`, `calcium`, `pth`, `zinc`.

**Urine** — `urine_color`, `urine_appearance`, `urine_specific_gravity`, `urine_ph`, `urine_protein`, `urine_glucose`, `urine_ketones`, `urine_blood`, `urine_nitrites`, `urine_leukocyte_esterase`, `urine_bilirubin`, `urine_urobilinogen`, `urine_erythrocytes_sediment`, `urine_leukocytes_sediment`, `urine_epithelial_cells`, `urine_bacteria`, `urine_crystals`.

Per ciascuno: `display_name_it`, `category`, `specimen`, `value_type`, `unit_canonical`, range di riferimento adulto generico, e 2–4 `lab_analyte_aliases` di partenza (varianti comuni italiane).

---

## 5. Pipeline di ingest

### 5.1 Flusso

```
POST /api/v1/lab/ingest
     ↓
[1] Salva file su volume + hash sha256 → lab_documents
[2] Estrazione testo con pdfplumber (PDF testuali garantiti)
[3] Chiamata Anthropic API (claude-sonnet-4-5) con system prompt IT
    → JSON strutturato { test_date, lab_name, specimen_types, analytes: [...] }
[4] Matching raw_name → analyte_id:
    - exact match (case-insensitive) su lab_analyte_aliases
    - similarity match (pg_trgm) soglia 0.6 → needs_review=true
    - nessun match → analyte_id=NULL, needs_review=true
[5] Crea lab_panel con status='draft' + lab_results
[6] Risponde con panel_id → dashboard apre review screen
```

### 5.2 Prompt LLM

System prompt (italiano, breve, deterministico):

```
Sei un parser di referti medici italiani. Ricevi il testo grezzo di un referto
di analisi del sangue e/o delle urine. Estrai esattamente:
- test_date (ISO YYYY-MM-DD, la data del prelievo, non la data di refertazione)
- lab_name (nome del laboratorio, stringa)
- specimen_types (array tra "blood", "urine")
- analytes: array di { raw_name, value_raw, unit_raw, ref_range_raw }
  dove value_raw è la stringa esatta del valore (può essere numero o testo
  come "assente", "tracce", "++", "negativo"); ref_range_raw è la stringa
  esatta del range come riportato nel referto, se presente.

Regole:
- Non normalizzare nulla. Non tradurre. Non inferire valori.
- Se un campo manca, usa null.
- Rispondi SOLO con JSON valido, niente testo prima o dopo, niente markdown.
```

User message = testo estratto dal PDF.

Chiamata: `temperature=0`, `max_tokens=4096`, risposta parsata con `json.loads` dentro try/except che marca il panel come `draft` con `notes="parsing_failed"` in caso di errore.

### 5.3 Conversione unità e range

Al momento del **commit** (non dell'ingest):
- Per ogni `lab_result` con `analyte_id` assegnato, confronta `unit_raw` con `unit_canonical`. Se diverse, applica conversione da tabella hardcoded (`ng/ml ↔ µg/l`, `mg/dl ↔ mmol/l` con fattore specifico per analita, ecc.). Scrive `unit_normalized` e `value_numeric` convertito.
- Calcola `out_of_range` confrontando con `ref_low`/`ref_high` dell'analita (o `ref_text` per qualitativi).
- Se conversione non disponibile → `needs_review=true`, `unit_normalized=NULL`.

---

## 6. API endpoints (FastAPI)

Tutti sotto `/api/v1/lab`.

| Metodo | Path | Descrizione |
|---|---|---|
| POST | `/ingest` | Upload PDF (multipart). Ritorna `{panel_id, draft_summary}`. |
| GET | `/panels` | Lista panel, filtrabile per `status`, `year`, `specimen`, `lab_name`. Paginato. |
| GET | `/panels/{id}` | Dettaglio panel + tutti i result + URL al documento. |
| PATCH | `/panels/{id}` | Edit `test_date`, `lab_name`, `notes`, `specimen_types`. |
| POST | `/panels/{id}/confirm` | Promuove `draft → confirmed`. Lancia conversione unità e calcolo `out_of_range`. Rifiuta se esistono `lab_results` con `analyte_id IS NULL`. |
| DELETE | `/panels/{id}` | Cancella panel + result + documento su disco. |
| PATCH | `/results/{id}` | Edit di un singolo result (analyte_id, value, unit, notes). Usato nella review screen. |
| POST | `/aliases` | Aggiunge un `lab_analyte_aliases`. Chiamato dalla review quando l'utente mappa manualmente un raw_name a un analita. |
| GET | `/analytes` | Lista catalogo. |
| POST | `/analytes` | Crea nuovo analita (per analiti non previsti nel seed). |
| GET | `/timeseries?analyte_slug=...&start=...&end=...` | Serie temporale di un analita (solo panel `confirmed`). Include `ref_low`, `ref_high` per banda del chart. |
| GET | `/matrix?start=...&end=...&category=...` | Vista matrice: ritorna `{analytes: [...], dates: [...], cells: {analyte_id: {date: value}}}`. |
| GET | `/documents/{id}/file` | Stream del PDF originale. |

---

## 7. Dashboard — pagina `Laboratorio`

Route `/lab` aggiunta al router. Voce nel nav drawer.

### 7.1 Layout

Coerente con le pagine esistenti (`Corpo`, `Workout`): sidebar filtri sinistra + contenuto destra. Tre tab in alto: **Matrice** | **Andamenti** | **Referti**.

### 7.2 Tab "Matrice"

Replica lo spreadsheet attuale. Tabella sticky con:
- Righe = analiti (raggruppate per `category`, collassabili).
- Colonne = date dei panel (ordinate DESC, più recente a sinistra).
- Celle colorate rosso se `out_of_range=true`, arancione se a ±5% dai limiti.
- Hover cella → tooltip con range di riferimento, unità, note.
- Click sull'intestazione colonna → dettaglio del panel.
- Click sul nome analita → salta al tab "Andamenti" preselezionato.

Usa `GET /matrix`. Dato che i dati sono sparsi, renderizzare solo celle non-null (celle vuote = stringa vuota).

### 7.3 Tab "Andamenti"

Multi-select analiti (max 5 per chart leggibile). Per ogni analita selezionato:
- Line chart Recharts con banda grigio chiaro tra `ref_low` e `ref_high`.
- Punti fuori range evidenziati in rosso.
- Asse Y per-serie (come già fatto in pagina `Corpo`).
- Tooltip multi-serie.

Preset range date (ultimi 12 mesi / 5 anni / tutto).

### 7.4 Tab "Referti"

Lista panel confermati + draft in coda in alto con badge giallo "da rivedere".

Click su un panel draft → **Review screen** (modal o pagina dedicata):
- Tabella editabile: `raw_name` (read-only) | `analyte` (Combobox con autocomplete dal catalogo + opzione "crea nuovo") | `value_raw` | `unit_raw` | `ref_range_raw` | azione "salva alias".
- Sticky bottom bar: "Conferma referto" (disabled se analyte_id mancante su qualche riga).
- Link al PDF originale in iframe laterale per confronto visivo.

### 7.5 Sidebar filtri

- Range date (preset + custom, come `Corpo`).
- Categoria (multi-chip).
- Specimen (`blood` / `urine`).
- Solo fuori range (toggle).
- Solo da rivedere (toggle).

### 7.6 Upload widget

Pulsante fisso in alto a destra della pagina: dropzone per PDF. Al drop → `POST /ingest` → spinner → al ritorno apre la Review screen sul nuovo `panel_id`.

### 7.7 Cross-reference peso

Nel dettaglio panel, card "Peso al prelievo": fetch `GET /api/v1/samples/latest?type=HKQuantityTypeIdentifierBodyMass&before={test_date}&window_days=3` (creare questo endpoint se non esiste nella forma esatta). Se trovato, mostra il valore e la data. **Non** salvare nel panel.

---

## 8. Gestione urine

Le urine hanno prevalenza di valori non-numerici. Il modello dati è già pronto (`value_type='semi_quantitative'|'qualitative'`, `value_text`, `ref_text`). Note implementative:

- In Review screen, se l'analita selezionato ha `value_type != 'numeric'`, il campo input diventa una select con i valori ammessi più comuni (`assente`, `tracce`, `+`, `++`, `+++`, `++++` per semi-quantitativi; `negativo`/`positivo` per qualitativi) più opzione "testo libero".
- `out_of_range` per qualitativi: confronto stringa normalizzata con `ref_text` (es. ref_text="assente" → fuori range se value_text in {`+`, `++`, `+++`, `++++`, `tracce`, `positivo`}).
- Nel chart "Andamenti", gli analiti non-numerici sono renderizzati come scatter plot ordinale (mapping `assente=0, tracce=1, +=2, ++=3, +++=4, ++++=5`) con asse Y categorico.

---

## 9. Import storico dallo spreadsheet

Script `backend/scripts/import_spreadsheet_lab.py`:

```
python scripts/import_spreadsheet_lab.py --file storico.xlsx --sheet Analisi [--dry-run] [--commit]
```

Logica:
1. Legge con `openpyxl` o `pandas`. Assume: riga 1 = header date (gg/mm/aa), colonna A = nome analita, riga "Note" → va in `panel.notes`.
2. Per ogni colonna data non vuota → crea un `lab_panel` con `test_date` parsata, `lab_name=NULL` (da completare a mano se vuole), `status='confirmed'` direttamente (l'utente ha già validato questi dati).
3. Per ogni cella non vuota in quella colonna → cerca l'analita via `lab_analyte_aliases` (case-insensitive). Se non trovato, log warning e skip in dry-run; in commit, crea `lab_result` con `analyte_id=NULL` e `needs_review=true`.
4. Parsing valore: se matcha `^[\d,.]+$` → `value_numeric` (convertendo virgola italiana). Altrimenti → `value_text`.
5. Parsing unità: se la cella contiene unità inline (es. "3,02 pg/ml"), estrae; altrimenti `unit_raw=NULL` → deve essere compilato post-import.
6. Dry-run produce report TSV con tutte le ambiguità. Commit fa le INSERT in una transazione.

Output dry-run in `stdout` + file `import_report.tsv`.

---

## 10. Guardrail e convenzioni

- **Branch**: `feature/lab-results`. Una PR per fase (vedi §11), non monolitica.
- **Aggiornare `CLAUDE.md`** con il nuovo dominio: convenzioni naming, dove vivono i PDF, policy review obbligatoria.
- **`.gitignore`**: aggiungere `backend/data/lab_documents/`.
- **Env var**: `ANTHROPIC_API_KEY` letta dal backend via `pydantic-settings`. La chiamata LLM si fa **solo dal backend**, mai dalla dashboard.
- **Test**: almeno 3 fixture PDF anonimizzati in `backend/tests/fixtures/lab/` + test parsing con mock della chiamata Anthropic (risposte LLM hardcoded).
- **Migration order**: (1) `lab_documents`, (2) `lab_analytes` + `lab_analyte_aliases` + seed, (3) `lab_panels`, (4) `lab_results`.
- **Privacy**: nel README aggiungere un disclaimer: i dati medici non vanno committati; fixture devono essere anonimizzate.
- **Niente auth**: coerente col resto del progetto single-user.

---

## 11. Roadmap in PR separate

| PR | Scope | Deliverable verificabile |
|---|---|---|
| **#1** | Schema DB + seed catalogo | Migration Alembic applicata, catalogo popolato, test CRUD base su `lab_analytes`. |
| **#2** | Endpoint upload + parsing LLM + review API | `POST /ingest` funzionante su un PDF fixture, panel creato in `draft`. |
| **#3** | Dashboard Tab "Referti" + Review screen | Upload dal browser → review → confirm end-to-end. |
| **#4** | Dashboard Tab "Matrice" + "Andamenti" | Vista matrice e chart con banda di riferimento. |
| **#5** | Script import storico | Import dello spreadsheet dell'utente in dry-run pulito. |
| **#6** | Cross-reference peso HK + widget home "fuori range" | Card dettaglio panel + widget home. |

**Possibili evoluzioni (non in questa roadmap):**
- Parser template-based specifico per il laboratorio ricorrente (skip LLM quando il layout è noto → azzera costo e latenza).
- Auto-commit per panel con tutti i matching exact e `out_of_range` entro soglia.
- Export FHIR DiagnosticReport via `loinc_code`.
- Notifiche (es. Telegram via n8n) su nuovi valori fuori range.

---

## 12. Primo prompt da dare a Claude Code

> Leggi `LAB_RESULTS_SPEC.md` in root. Apri la PR #1 secondo §11: crea le migration Alembic per le quattro tabelle del §4.1 nell'ordine indicato in §10, crea la migration separata `seed_lab_analytes` col catalogo del §4.2 (almeno 25 sangue + 15 urine con alias e range plausibili, fonti standard italiane), aggiungi i modelli SQLAlchemy async corrispondenti sotto `backend/app/models/lab.py`, e i test CRUD base. Non toccare ancora endpoint, dashboard, né parsing LLM: solo schema e seed. Aggiorna `.gitignore` e `CLAUDE.md`.
