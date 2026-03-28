#!/usr/bin/env python3
"""
Sanity-check script for Hypothesis AI Search experiment logs (flat single-participant schema).

Usage:
    python scripts/inspect-experiment-log.py experiment-log-2026-03-27.json
    python scripts/inspect-experiment-log.py log1.json log2.json   # merge multiple logs
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from datetime import datetime
from typing import Any


def load_and_merge(paths: list[str]) -> dict[str, Any]:
    """Load one or more log files and merge into one flat document."""
    merged: dict[str, Any] = {
        "version": 1,
        "events": [],
        "annotationStatuses": {},
    }
    for path in paths:
        with open(path, encoding="utf-8") as f:
            log = json.load(f)
        # Flat export (current)
        if "users" not in log and isinstance(log.get("events"), list):
            merged["events"].extend(log.get("events", []))
            statuses = log.get("annotationStatuses") or {}
            if isinstance(statuses, dict):
                merged["annotationStatuses"].update(statuses)
            continue
        # Legacy per-user shape: fold into single stream
        users = log.get("users") or {}
        if isinstance(users, dict):
            for _user, user_log in users.items():
                if not isinstance(user_log, dict):
                    continue
                merged["events"].extend(user_log.get("events", []))
                us = user_log.get("annotationStatuses") or {}
                if isinstance(us, dict):
                    merged["annotationStatuses"].update(us)

    merged["events"].sort(key=lambda e: str(e.get("timestamp", "")))
    return merged


def print_section(title: str) -> None:
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}")


def print_subsection(title: str) -> None:
    print(f"\n  --- {title} ---")


EVENT_TYPES_ORDER = [
    "search",
    "rerun-search",
    "accept",
    "reject",
    "delete-pending",
    "delete-all",
    "annotation-deleted",
]


def inspect(log: dict[str, Any]) -> None:
    events = log.get("events") or []
    statuses = log.get("annotationStatuses") or {}
    if not events and not statuses:
        print("Log is empty (no events or statuses).")
        return

    exported_at = log.get("exportedAt")
    if exported_at:
        print(f"Exported at: {exported_at}")

    print_section("Summary (single stream)")

    event_counts = Counter(e.get("type", "?") for e in events if isinstance(e, dict))
    print_subsection("Event counts")
    for event_type in EVENT_TYPES_ORDER:
        if event_type in event_counts:
            print(f"    {event_type:20s} {event_counts[event_type]}")
    for et, n in sorted(event_counts.items()):
        if et not in EVENT_TYPES_ORDER:
            print(f"    {et:20s} {n}")
    print(f"    {'TOTAL':20s} {len(events)}")

    if isinstance(statuses, dict):
        status_counts = Counter(
            s.get("status", "?") for s in statuses.values() if isinstance(s, dict)
        )
        print_subsection("Annotation statuses")
        for status in ["suggested", "accepted", "rejected"]:
            print(f"    {status:20s} {status_counts.get(status, 0)}")
        print(f"    {'TOTAL':20s} {len(statuses)}")

    doc_events: dict[str, list] = {}
    for e in events:
        if not isinstance(e, dict):
            continue
        uri = e.get("documentUri", "(unknown)")
        doc_events.setdefault(str(uri), []).append(e)

    doc_statuses: dict[str, list] = {}
    if isinstance(statuses, dict):
        for s in statuses.values():
            if not isinstance(s, dict):
                continue
            uri = s.get("documentUri", "(unknown)")
            doc_statuses.setdefault(str(uri), []).append(s)

    all_uris = sorted(set(doc_events) | set(doc_statuses))
    if len(all_uris) > 1:
        print_subsection("Per-document breakdown")
        for uri in all_uris:
            de = doc_events.get(uri, [])
            ds = doc_statuses.get(uri, [])
            ec = Counter(e.get("type", "?") for e in de if isinstance(e, dict))
            sc = Counter(s.get("status", "?") for s in ds if isinstance(s, dict))
            short_uri = uri if len(uri) <= 60 else "..." + uri[-57:]
            print(f"\n    Document: {short_uri}")
            print(f"      Events:  {dict(ec)}")
            print(f"      Statuses: {dict(sc)}")

    print_subsection("Event timeline")
    for e in events:
        if not isinstance(e, dict):
            continue
        ts = e.get("timestamp", "?")
        try:
            ts_short = datetime.fromisoformat(str(ts).replace("Z", "+00:00")).strftime(
                "%Y-%m-%d %H:%M:%S"
            )
        except (ValueError, TypeError):
            ts_short = str(ts)
        etype = e.get("type", "?")
        detail = _event_detail(e, etype)
        print(f"    [{ts_short}] {str(etype):15s} {detail}")

    warnings: list[str] = []

    search_created_ids: set[str] = set()
    for e in events:
        if isinstance(e, dict) and e.get("type") == "search":
            search_created_ids.update(e.get("annotationIdsCreated") or [])

    for e in events:
        if not isinstance(e, dict):
            continue
        if e.get("type") in ("accept", "reject"):
            ann_id = e.get("annotationId", "")
            if ann_id and ann_id not in search_created_ids:
                warnings.append(
                    f'{e.get("type")} for annotation {ann_id} '
                    f"has no matching search event (ids created)"
                )

    if isinstance(statuses, dict):
        suggested = [s for s in statuses.values() if isinstance(s, dict) and s.get("status") == "suggested"]
        if suggested:
            warnings.append(
                f"{len(suggested)} annotation(s) still in 'suggested' state "
                f"(never accepted or rejected)"
            )

    seen_events: set[tuple[Any, ...]] = set()
    for e in events:
        if not isinstance(e, dict):
            continue
        key = (e.get("type"), e.get("annotationId", ""), e.get("timestamp", ""))
        if key in seen_events:
            warnings.append(f"Possible duplicate event: {key}")
        seen_events.add(key)

    print_subsection("Warnings")
    if warnings:
        for w in warnings:
            print(f"    [!] {w}")
    else:
        print("    None")


def _event_detail(e: dict[str, Any], etype: str) -> str:
    if etype == "search":
        return (
            f'tag="{e.get("schemaTag", "")}" '
            f'query="{str(e.get("query", ""))[:50]}" '
            f'annotations={len(e.get("annotationIdsCreated") or [])}'
        )
    if etype == "rerun-search":
        return (
            f'tag="{e.get("schemaTag", "")}" '
            f'query="{str(e.get("query", ""))[:50]}" '
            f'row={e.get("searchRowId", "")}'
        )
    if etype in ("accept", "reject"):
        quote = e.get("quoteText", "")
        quote_short = (quote[:40] + "...") if len(str(quote)) > 40 else quote
        return f'ann={e.get("annotationId", "?")} quote="{quote_short}"'
    if etype == "delete-pending":
        return (
            f'tag="{e.get("schemaTag", "")}" '
            f'query="{str(e.get("query", ""))[:50]}" '
            f'row={e.get("searchRowId", "")}'
        )
    if etype == "delete-all":
        return (
            f'tag="{e.get("schemaTag", "")}" '
            f'query="{str(e.get("query", ""))[:50]}" '
            f'row={e.get("searchRowId", "")}'
        )
    if etype == "annotation-deleted":
        quote = e.get("quoteText", "")
        quote_short = (str(quote)[:40] + "...") if len(str(quote)) > 40 else quote
        return f'ann={e.get("annotationId", "?")} quote="{quote_short}"'
    return ""


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <log.json> [log2.json ...]")
        sys.exit(1)

    log = load_and_merge(sys.argv[1:])
    inspect(log)


if __name__ == "__main__":
    main()
