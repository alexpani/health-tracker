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
from urllib import request as urlrequest


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


def build_entry_html(entry: dict) -> str:
    """HTML per una singola entry DayOne (testo + footer foto + audio)."""
    return entry_to_html(entry) + photo_footer(entry) + audio_footer(entry)


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


def api_delete_tag(api_url: str, tag: str) -> int:
    """Elimina TUTTE le voci che contengono `tag`. Ritorna il numero di
    voci cancellate. Usato dal flag --delete-tag-before per ripulire un
    import precedente prima di re-importare. Paginazione interna (il
    list endpoint cappa a 1000 entries per request)."""
    ids: list[int] = []
    offset = 0
    while True:
        req = urlrequest.Request(
            f"{api_url}/api/v1/journal?tag={tag}&limit=1000&offset={offset}"
        )
        with urlrequest.urlopen(req, timeout=20) as r:
            page = json.loads(r.read())
        if not page:
            break
        ids.extend(e["id"] for e in page)
        if len(page) < 1000:
            break
        offset += len(page)
    if not ids:
        return 0
    res = api_post(api_url, "/api/v1/journal/bulk", {"ids": ids, "action": "delete"})
    return int(res.get("deleted", 0))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", help="DayOne JSON export")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--api-url", default="http://192.168.68.166:8000")
    ap.add_argument(
        "--extra-tag",
        default="dayone",
        help="comma-separated tags da applicare a tutte le voci",
    )
    ap.add_argument(
        "--delete-tag-before",
        default=None,
        help="Prima dell'import, cancella TUTTE le voci che hanno questo tag. "
             "Utile per re-importare un export.",
    )
    args = ap.parse_args()

    with open(args.file) as f:
        data = json.load(f)
    entries = data.get("entries") or []
    print(f"[info] loaded {len(entries)} entries from {args.file}")

    tags = [t.strip().lower() for t in args.extra_tag.split(",") if t.strip()]
    if tags:
        print(f"[info] auto-tag: {tags}")

    # Cleanup pre-import
    if args.delete_tag_before:
        cleanup_tag = args.delete_tag_before.strip().lower()
        if args.dry_run:
            print(f"[DRY] avrei cancellato tutte le voci con tag '{cleanup_tag}'")
        else:
            n = api_delete_tag(args.api_url, cleanup_tag)
            print(f"[cleanup] cancellate {n} voci preesistenti con tag '{cleanup_tag}'")

    by_day: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        cd = e.get("creationDate") or ""
        day = cd[:10]
        if day:
            by_day[day].append(e)

    print(f"[info] {len(entries)} entry su {len(by_day)} giorni distinti")

    n_created = 0
    n_failed = 0
    failed: list[tuple[str, str]] = []

    # IMPORTANTE: una entry DayOne = una nota nel diario (non piu' merge
    # per giorno). I giorni con piu' entry creano piu' note.
    for day in sorted(by_day.keys()):
        day_entries = sorted(by_day[day], key=lambda e: e.get("creationDate", ""))
        for idx, e in enumerate(day_entries):
            html = build_entry_html(e)
            body = {"date": day, "content_html": html, "tags": tags}
            label = day if len(day_entries) == 1 else f"{day} [{idx+1}/{len(day_entries)}]"

            if args.dry_run:
                preview = html[:120].replace("\n", " ")
                print(f"  [DRY] {label}: -> {len(html)} chars / preview: {preview}")
                continue

            try:
                res = api_post(args.api_url, "/api/v1/journal", body)
                n_created += 1
                print(f"  [ok]   {label}: id={res['id']} text_len={len(res['content_text'])}")
            except Exception as exc:
                n_failed += 1
                failed.append((label, str(exc)))
                print(f"  [FAIL] {label}: {exc}")

    print("\n=== summary ===")
    print(f"  entry totali: {len(entries)}")
    print(f"  giorni:       {len(by_day)}")
    print(f"  create:       {n_created}")
    print(f"  failed:       {n_failed}")
    if failed:
        print("  failed details:")
        for d, msg in failed:
            print(f"    {d}: {msg}")
    if args.dry_run:
        print("  (dry-run: nessuna scrittura)")
    return 0 if n_failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
