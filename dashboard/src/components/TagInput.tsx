import { useState } from "react"
import { X } from "lucide-react"

interface Props {
  value: string[]
  onChange: (next: string[]) => void
  suggestions?: string[]
  placeholder?: string
}

/** Chip input con autocomplete via datalist HTML5. Tag normalizzati a
 * lowercase trim al volo, dedup automatico. Invio o virgola aggiunge,
 * Backspace su input vuoto rimuove l'ultimo. */
export function TagInput({ value, onChange, suggestions = [], placeholder }: Props) {
  const [draft, setDraft] = useState("")

  const commit = (raw: string) => {
    const t = raw.trim().toLowerCase()
    if (!t) return
    if (value.includes(t)) {
      setDraft("")
      return
    }
    onChange([...value, t])
    setDraft("")
  }

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      commit(draft)
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  const remove = (t: string) => onChange(value.filter(x => x !== t))

  const datalistId = "tag-input-suggestions"
  const available = suggestions.filter(s => !value.includes(s))

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring">
      {value.map(t => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200"
        >
          {t}
          <button
            type="button"
            onClick={() => remove(t)}
            className="rounded-full p-0.5 hover:bg-indigo-200 dark:hover:bg-indigo-800"
            aria-label={`Rimuovi tag ${t}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => draft.trim() && commit(draft)}
        placeholder={value.length === 0 ? (placeholder ?? "Aggiungi tag e premi Invio") : ""}
        list={datalistId}
        autoComplete="off"
        className="flex-1 min-w-[120px] bg-transparent outline-none placeholder:text-muted-foreground"
      />
      <datalist id={datalistId}>
        {available.map(s => <option key={s} value={s} />)}
      </datalist>
    </div>
  )
}
