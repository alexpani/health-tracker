import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(n: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n)
}

// Parse "YYYY-MM-DD" or full ISO and return Date in local TZ.
// For "YYYY-MM-DD" alone, append T00:00:00 to avoid UTC shift.
function toDate(d: Date | string): Date {
  if (d instanceof Date) return d
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(d + "T00:00:00")
  return new Date(d)
}

const pad = (n: number) => String(n).padStart(2, "0")

// 31-12-2008
export function formatDate(d: Date | string): string {
  const x = toDate(d)
  return `${pad(x.getDate())}-${pad(x.getMonth() + 1)}-${x.getFullYear()}`
}

// 31-12
export function formatDateShort(d: Date | string): string {
  const x = toDate(d)
  return `${pad(x.getDate())}-${pad(x.getMonth() + 1)}`
}

// 31-12-08
export function formatDateShortYear(d: Date | string): string {
  const x = toDate(d)
  return `${pad(x.getDate())}-${pad(x.getMonth() + 1)}-${String(x.getFullYear()).slice(2)}`
}

// 31-12-2008 14:30
export function formatDateTime(d: Date | string): string {
  const x = toDate(d)
  return `${formatDate(x)} ${pad(x.getHours())}:${pad(x.getMinutes())}`
}

// dic 2008 — month abbr italiano + anno
export function formatMonthYear(d: Date | string): string {
  const x = toDate(d)
  return new Intl.DateTimeFormat("it-IT", { month: "short", year: "numeric" }).format(x)
}

// dicembre 2008
export function formatMonthYearLong(d: Date | string): string {
  const x = toDate(d)
  return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(x)
}

// lunedì 31 dicembre 2008 — usato dove serve la data "estesa" leggibile
export function formatDateLong(d: Date | string): string {
  const x = toDate(d)
  return new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(x)
}
