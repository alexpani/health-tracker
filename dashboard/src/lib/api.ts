const API_URL = import.meta.env.VITE_API_URL || "http://192.168.68.166:8000"

export async function apiGet<T>(path: string, params?: Record<string, string | number | string[] | undefined | null>): Promise<T> {
  const url = new URL(`${API_URL}${path}`)
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null) return
      if (Array.isArray(v)) {
        v.forEach(item => url.searchParams.append(k, String(item)))
      } else {
        url.searchParams.set(k, String(v))
      }
    })
  }
  const res = await fetch(url.toString())
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${res.status}: ${body}`)
  }
  return res.json()
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const url = `${API_URL}${path}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`API ${res.status}: ${errBody}`)
  }
  return res.json()
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  return res.json()
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: "DELETE" })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  return res.json()
}

export async function apiUpload<T>(path: string, file: File, fieldName = "file"): Promise<T> {
  const form = new FormData()
  form.append(fieldName, file)
  const res = await fetch(`${API_URL}${path}`, { method: "POST", body: form })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  return res.json()
}

export { API_URL }
