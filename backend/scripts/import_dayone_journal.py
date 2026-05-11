"""Importa un export DayOne (Sport.json o simili) come voci del diario
giornaliero (`/api/v1/journal`).

Regole concordate:
- una voce per giorno; giorni con piu' voci DayOne -> concatenate con un
  `<h3>HH:MM</h3>` per ognuna, in ordine cronologico
- contenuto: usa `richText` (Quill-Delta DayOne) se presente, altrimenti
  `text` (plain) wrappato in <p>
- foto: nessun upload, solo nota testuale "📷 N foto allegate" in coda
- tag forzato `dayone` su tutte le voci
- conflitto: se la data ha gia' una entry sul server, skip (logga)

Usage:
    python import_dayone_journal.py path/to/Sport.json [--dry-run]
                                    [--api-url http://192.168.68.166:8000]
                                    [--extra-tag tag1,tag2]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime
from html import escape
from urllib import error as urlerror, request as urlrequest


def quill_to_html(delta: dict) -> str:
    """Converte un richText DayOne (Quill-Delta-like) in HTML.

    Struttura: {"contents": [{"text": "...", "attributes": {...}}, ...]}
    Attribute supportati:
      - line.header = 1|2|3  -> blocco H1/H2/H3
      - bold / italic / underline / strikethrough -> <strong>/<em>/<u>/<s>
    Newline finale di un segmento "header" chiude il blocco; nel testo
    semplice ogni "\n\n" e' separazione paragrafi, "\n" singolo e' <br>.
    """
    contents = (delta or {}).get("contents") or []
    out: list[str] = []
    para_buf: list[str] = []

    def flush_para():
        if not para_buf:
            return
        txt = "".join(para_buf)
        para_buf.clear()
        for p in _split_paragraphs(txt):
            if p.strip():
                out.append(f"<p>{p}</p>")

    for seg in contents:
        seg_text = seg.get("text") or ""
        attrs = seg.get("attributes") or {}
        line_header = (attrs.get("line") or {}).get("header")

        # Inline marks
        marked = escape(seg_text)
        # I newline interni li rendiamo a <br> SOLO se non sono header,
        # altrimenti spezzano il blocco.
        if attrs.get("bold"):
            marked = f"<strong>{marked}</strong>"
        if attrs.get("italic"):
            marked = f"<em>{marked}</em>"
        if attrs.get("underline"):
            marked = f"<u>{marked}</u>"
        if attrs.get("strikethrough") or attrs.get("strike"):
            marked = f"<s>{marked}</s>"

        if line_header:
            # header chiude il paragrafo corrente e crea un <hN>
            flush_para()
            level = min(max(int(line_header), 1), 3)
            # Quill-Delta convention: il "\n" alla fine di un segmento header
            # appartiene all'header. Lo strippo.
            inner = marked.rstrip("\n").replace("\n", "<br>")
            if inner.strip():
                out.append(f"<h{level}>{inner}</h{level}>")
        else:
            para_buf.append(marked)

    flush_para()
    html = "".join(out).strip()
    return html or "<p></p>"


def _split_paragraphs(text: str) -> list[str]:
    """Split su \\n\\n -> paragrafi; \\n singoli -> <br> dentro il paragrafo."""
    parts = text.split("\n\n")
    return [p.replace("\n", "<br>") for p in parts]


def plain_to_html(text: str) -> str:
    text = text or ""
    # DayOne talvolta escapa caratteri markdown nel `text`: \-, \(, \), \*, \_
    for esc in ("\\-", "\\(", "\\)", "\\*", "\\_", "\\#", "\\."):
        text = text.replace(esc, esc[1:])
    parts = [p.strip() for p in text.split("\n\n")]
    out = []
    for p in parts:
        if not p:
            continue
        out.append(f"<p>{escape(p).replace(chr(10), '<br>')}</p>")
    return "".join(out) or "<p></p>"


def entry_to_html(entry: dict) -> str:
    rt_raw = entry.get("richText")
    if rt_raw:
        if isinstance(rt_raw, str):
            try:
                delta = json.loads(rt_raw)
            except json.JSONDecodeError:
                delta = None
        else:
            delta = rt_raw
        if delta:
            return quill_to_html(delta)
    return plain_to_html(entry.get("text") or "")


def photo_footer(entry: dict) -> str:
    n = len(entry.get("photos") or [])
    if not n:
        return ""
    word = "foto allegata" if n == 1 else "foto allegate"
    return f"<p>📷 {n} {word} (non importate)</p>"


def audio_footer(entry: dict) -> str:
    """Per ogni audio con `transcription` non vuoto, lo aggiungo in coda
    come blockquote. Gli audio senza transcription vengono comunque
    contati con una nota testuale (come per le foto)."""
    audios = entry.get("audios") or []
    if not audios:
        return ""
    out: list[str] = []
    no_transcript = 0
    for a in audios:
        tr = (a.get("transcription") or "").strip()
        if tr:
            out.append(
                f"<blockquote>🎙️ Trascrizione audio: {escape(tr)}</blockquote>"
            )
        else:
            no_transcript += 1
    if no_transcript:
        word = "audio allegato" if no_transcript == 1 else "audio allegati"
        out.append(
            f"<p>🎙️ {no_transcript} {word} (senza trascrizione)</p>"
        )
    return "".join(out)


def build_day_html(day: str, entries: list[dict]) -> str:
    """Costruisce il content_html per un giorno.

    Una entry sola -> solo il suo HTML.
    Piu' entries  -> ognuna preceduta da <h3>HH:MM</h3>, ordinate
    cronologicamente.
    """
    entries_sorted = sorted(entries, key=lambda e: e.get("creationDate", ""))
    if len(entries_sorted) == 1:
        e = entries_sorted[0]
        return entry_to_html(e) + photo_footer(e) + audio_footer(e)

    out: list[str] = []
    for e in entries_sorted:
        ts = e.get("creationDate", "")
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            label = dt.strftime("%H:%M")
        except Exception:
            label = ts[11:16] if len(ts) >= 16 else ts
        out.append(f"<h3>{label}</h3>")
        out.append(entry_to_html(e))
        out.append(photo_footer(e))
        out.append(audio_footer(e))
    return "".join(out)


def api_get_or_none(api_url: str, path: str) -> dict | None:
    req = urlrequest.Request(f"{api_url}{path}")
    try:
        with urlrequest.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except urlerror.HTTPError as e:
        if e.code == 404:
            return None
        raise


def api_post(api_url: str, path: str, body: dict) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urlrequest.Request(
        f"{api_url}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlrequest.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", help="DayOne JSON export")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--api-url", default="http://192.168.68.166:8000")
    ap.add_argument("--extra-tag", default="dayone",
                    help="comma-separated tags da applicare a tutte le voci")
    args = ap.parse_args()

    with open(args.file) as f:
        data = json.load(f)
    entries = data.get("entries") or []
    print(f"[info] loaded {len(entries)} entries from {args.file}")

    tags = [t.strip().lower() for t in args.extra_tag.split(",") if t.strip()]
    if tags:
        print(f"[info] auto-tag: {tags}")

    by_day: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        cd = e.get("creationDate") or ""
        day = cd[:10]
        if day:
            by_day[day].append(e)

    print(f"[info] distinct days: {len(by_day)}")

    n_created = 0
    n_skipped_exists = 0
    n_failed = 0
    skipped_days: list[str] = []
    failed_days: list[tuple[str, str]] = []

    for day in sorted(by_day.keys()):
        day_entries = by_day[day]
        html = build_day_html(day, day_entries)
        body = {"date": day, "content_html": html, "tags": tags}

        # Conflict check
        existing = None
        if not args.dry_run:
            existing = api_get_or_none(args.api_url, f"/api/v1/journal/by-date/{day}")
        if existing is not None:
            n_skipped_exists += 1
            skipped_days.append(day)
            print(f"  [skip] {day}: voce gia' presente (id={existing.get('id')})")
            continue

        if args.dry_run:
            preview = html[:120].replace("\n", " ")
            print(f"  [DRY] {day}: {len(day_entries)} entry(s) -> {len(html)} chars HTML / preview: {preview}")
            continue

        try:
            res = api_post(args.api_url, "/api/v1/journal", body)
            n_created += 1
            print(f"  [ok]   {day}: id={res['id']} text_len={len(res['content_text'])}")
        except Exception as exc:
            n_failed += 1
            failed_days.append((day, str(exc)))
            print(f"  [FAIL] {day}: {exc}")

    print("\n=== summary ===")
    print(f"  days total:   {len(by_day)}")
    print(f"  created:      {n_created}")
    print(f"  skipped(exists): {n_skipped_exists}")
    print(f"  failed:       {n_failed}")
    if failed_days:
        print("  failed details:")
        for d, msg in failed_days:
            print(f"    {d}: {msg}")
    if args.dry_run:
        print("  (dry-run: nessuna scrittura)")
    return 0 if n_failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
