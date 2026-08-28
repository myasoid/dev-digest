#!/usr/bin/env python3
"""
workflow-retro collector — measures one multi-agent run from its transcripts.

Reads the session's subagent JSONL files (and the parent transcript) and emits a
single JSON document on stdout. Measurement only: every number here is derived
from a file on disk. Judgement belongs in the skill, not in this script.

Usage:
    python3 collect.py                     # newest session under this project
    python3 collect.py --session <uuid>
    python3 collect.py --list              # show candidate sessions, newest first

Transcripts live at ~/.claude/projects/<mangled-cwd>/, where <mangled-cwd> is the
absolute path with every '/' replaced by '-'. Subagent transcripts are under
<session-uuid>/subagents/agent-<id>.jsonl with an adjacent .meta.json naming the
agent type and its one-line description.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------- cost model
#
# Multipliers are relative to the SAME MODEL's base input price and are uniform
# across tiers: a cache read is 0.1x that model's input token, a 5-minute cache
# write 1.25x, a 1-hour cache write 2x. Only the base price differs per model.
#
# WEIGHTED INPUT TOKENS IS THE HEADLINE NUMBER and needs no price table — it is
# "how many input tokens this run cost, if you priced cache reads and writes at
# what they actually cost". USD is secondary and is null when the model is not
# in the table below, because a wrong price is worse than no price.
CACHE_READ_MULT = 0.10
CACHE_WRITE_5M_MULT = 1.25
CACHE_WRITE_1H_MULT = 2.00

# Base $/MTok, verified 2026-08-25 against the claude-api skill's model table.
# Matched by longest prefix, so dated snapshots resolve (claude-haiku-4-5-2025... -> claude-haiku-4-5).
PRICES_USD_PER_MTOK = {
    "claude-fable-5": {"input": 10.00, "output": 50.00},
    "claude-mythos-5": {"input": 10.00, "output": 50.00},
    "claude-opus-4-8": {"input": 5.00, "output": 25.00},
    "claude-opus-4-7": {"input": 5.00, "output": 25.00},
    "claude-opus-4-6": {"input": 5.00, "output": 25.00},
    "claude-opus-4-5": {"input": 5.00, "output": 25.00},
    "claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
    "claude-sonnet-4-5": {"input": 3.00, "output": 15.00},
    "claude-haiku-4-5": {"input": 1.00, "output": 5.00},
}

CHARS_PER_TOKEN = 4  # repo-wide estimate convention; see reviewer-core/src/prompt.ts


def price_for(model):
    if not model:
        return None
    best = None
    for prefix, p in PRICES_USD_PER_MTOK.items():
        if model.startswith(prefix) and (best is None or len(prefix) > len(best[0])):
            best = (prefix, p)
    return best[1] if best else None


def ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def read_jsonl(path):
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def project_dir(cwd):
    return Path.home() / ".claude" / "projects" / str(Path(cwd).resolve()).replace("/", "-")


def find_sessions(pdir):
    """Sessions that actually spawned subagents, newest activity first."""
    out = []
    if not pdir.is_dir():
        return out
    for sub in pdir.glob("*/subagents"):
        files = sorted(sub.glob("agent-*.jsonl"))
        if files:
            out.append((sub.parent.name, max(f.stat().st_mtime for f in files), sub))
    out.sort(key=lambda r: r[1], reverse=True)
    return out


# ------------------------------------------------------------------ per agent

DENIAL_RE = re.compile(r"Permission for this action was denied", re.I)


def analyse_agent(jsonl_path):
    meta_path = jsonl_path.with_suffix("").with_suffix(".meta.json")
    meta = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
        except json.JSONDecodeError:
            pass

    agent_id = jsonl_path.stem.replace("agent-", "")
    tok = dict(input=0, output=0, cache_read=0, cache_write_5m=0, cache_write_1h=0)
    models, times, tools = Counter(), [], Counter()
    reads, denials, errors, turns = [], 0, 0, 0

    for rec in read_jsonl(jsonl_path):
        if t := ts(rec.get("timestamp")):
            times.append(t)
        msg = rec.get("message") or {}

        if u := msg.get("usage"):
            turns += 1
            tok["input"] += u.get("input_tokens") or 0
            tok["output"] += u.get("output_tokens") or 0
            tok["cache_read"] += u.get("cache_read_input_tokens") or 0
            cc = u.get("cache_creation") or {}
            f5 = cc.get("ephemeral_5m_input_tokens")
            f1 = cc.get("ephemeral_1h_input_tokens")
            if f5 is None and f1 is None:
                # Older records carry only the flat total; assume 5m (the default TTL).
                tok["cache_write_5m"] += u.get("cache_creation_input_tokens") or 0
            else:
                tok["cache_write_5m"] += f5 or 0
                tok["cache_write_1h"] += f1 or 0
            if m := msg.get("model"):
                models[m] += 1

        content = msg.get("content")
        if isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_use":
                    tools[block.get("name", "?")] += 1
                    if block.get("name") == "Read":
                        p = (block.get("input") or {}).get("file_path")
                        if p:
                            reads.append(p)
                elif block.get("type") == "tool_result":
                    if block.get("is_error"):
                        errors += 1
                    c = block.get("content")
                    text = c if isinstance(c, str) else json.dumps(c)
                    if DENIAL_RE.search(text or ""):
                        denials += 1

    weighted = (
        tok["input"]
        + CACHE_READ_MULT * tok["cache_read"]
        + CACHE_WRITE_5M_MULT * tok["cache_write_5m"]
        + CACHE_WRITE_1H_MULT * tok["cache_write_1h"]
    )
    model = models.most_common(1)[0][0] if models else None
    price = price_for(model)
    cost = None
    if price:
        cost = round(
            weighted / 1e6 * price["input"] + tok["output"] / 1e6 * price["output"], 4
        )

    start, end = (min(times), max(times)) if times else (None, None)
    read_counts = Counter(reads)

    return {
        "agent_id": agent_id,
        "agent_type": meta.get("agentType"),
        "description": meta.get("description"),
        "spawn_depth": meta.get("spawnDepth"),
        "model": model,
        "model_priced": price is not None,
        "turns": turns,
        "tokens": tok,
        "weighted_input_tokens": round(weighted),
        "cost_usd": cost,
        "started_at": start.isoformat() if start else None,
        "ended_at": end.isoformat() if end else None,
        "duration_s": round((end - start).total_seconds(), 1) if start and end else None,
        "tools": dict(tools.most_common()),
        "files_read": sorted(read_counts),
        "reread_within_agent": {p: c for p, c in read_counts.items() if c > 1},
        "denied_tool_calls": denials,
        "tool_errors": errors,
        "_start": start,
        "_end": end,
    }


# ------------------------------------------------------------------ the run


def active_union_seconds(agents):
    """Seconds during which at least one agent was running. Divides sum-of-durations
    into a real parallelism figure — dividing by the full span instead would count
    idle gaps between phases as if agents had been running serially through them."""
    ivs = sorted(
        [(a["_start"], a["_end"]) for a in agents if a["_start"] and a["_end"]]
    )
    total, cur_s, cur_e = 0.0, None, None
    for s, e in ivs:
        if cur_e is None or s > cur_e:
            if cur_e is not None:
                total += (cur_e - cur_s).total_seconds()
            cur_s, cur_e = s, e
        else:
            cur_e = max(cur_e, e)
    if cur_e is not None:
        total += (cur_e - cur_s).total_seconds()
    return round(total, 1)


def overlap_clusters(agents):
    """Group agents whose active intervals overlap; each cluster is a de-facto
    parallel batch. straggler_gap_s is how long the first finisher sat idle if a
    barrier waited for the whole cluster."""
    live = sorted(
        [a for a in agents if a["_start"] and a["_end"]], key=lambda a: a["_start"]
    )
    clusters, cur = [], []
    cur_end = None
    for a in live:
        if cur and a["_start"] <= cur_end:
            cur.append(a)
            cur_end = max(cur_end, a["_end"])
        else:
            if cur:
                clusters.append(cur)
            cur, cur_end = [a], a["_end"]
    if cur:
        clusters.append(cur)

    out = []
    for c in clusters:
        if len(c) < 2:
            continue
        ends = [a["_end"] for a in c]
        out.append(
            {
                "agents": [a["description"] or a["agent_id"] for a in c],
                "size": len(c),
                "span_s": round((max(ends) - min(a["_start"] for a in c)).total_seconds(), 1),
                "straggler_gap_s": round((max(ends) - min(ends)).total_seconds(), 1),
                "fastest": min(c, key=lambda a: a["duration_s"] or 0)["description"],
                "slowest": max(c, key=lambda a: a["duration_s"] or 0)["description"],
            }
        )
    return out


def duplicated_reads(agents):
    """Files independently read by more than one agent — grounding the parent
    could have hoisted. Token figures are chars/4 estimates of the file as it
    stands now, not of what was actually sent."""
    by_file = defaultdict(list)
    for a in agents:
        for p in a["files_read"]:
            by_file[p].append(a["description"] or a["agent_id"])
    rows, wasted = [], 0
    for path, who in sorted(by_file.items(), key=lambda kv: -len(kv[1])):
        if len(who) < 2:
            continue
        try:
            est = os.path.getsize(path) // CHARS_PER_TOKEN
        except OSError:
            est = None
        if est:
            wasted += est * (len(who) - 1)
        rows.append(
            {
                "path": path,
                "agents": who,
                "times": len(who),
                "est_tokens_each": est,
                "est_redundant_tokens": est * (len(who) - 1) if est else None,
            }
        )
    return rows, wasted


def parent_spawns(pdir, session_id):
    """Launch order + brief size, from the parent transcript's Agent tool results."""
    path = pdir / f"{session_id}.jsonl"
    if not path.exists():
        return []
    out = []
    for rec in read_jsonl(path):
        r = rec.get("toolUseResult")
        if isinstance(r, dict) and "agentId" in r:
            prompt = r.get("prompt") or ""
            out.append(
                {
                    "agent_id": r.get("agentId"),
                    "description": r.get("description"),
                    "resolved_model": r.get("resolvedModel"),
                    "status": r.get("status"),
                    "background": r.get("isAsync"),
                    "brief_chars": len(prompt),
                    "brief_est_tokens": len(prompt) // CHARS_PER_TOKEN,
                    "at": rec.get("timestamp"),
                }
            )
    return out


def parent_denials(pdir, session_id):
    path = pdir / f"{session_id}.jsonl"
    if not path.exists():
        return 0
    n = 0
    for rec in read_jsonl(path):
        blob = json.dumps(rec.get("message") or {})
        n += len(DENIAL_RE.findall(blob))
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--session")
    ap.add_argument("--cwd", default=os.getcwd())
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    pdir = project_dir(args.cwd)
    sessions = find_sessions(pdir)
    if args.list:
        for sid, mtime, _ in sessions:
            print(f"{datetime.fromtimestamp(mtime).isoformat(timespec='seconds')}  {sid}")
        return 0
    if not sessions:
        print(json.dumps({"error": f"no sessions with subagents under {pdir}"}))
        return 1

    if args.session:
        match = [s for s in sessions if s[0] == args.session]
        if not match:
            print(json.dumps({"error": f"session {args.session} has no subagents"}))
            return 1
        sid, _, subdir = match[0]
    else:
        sid, _, subdir = sessions[0]

    agents = [analyse_agent(p) for p in sorted(subdir.glob("agent-*.jsonl"))]
    agents.sort(key=lambda a: a["_start"] or datetime.max)

    dup_rows, dup_tokens = duplicated_reads(agents)
    clusters = overlap_clusters(agents)
    starts = [a["_start"] for a in agents if a["_start"]]
    ends = [a["_end"] for a in agents if a["_end"]]
    sum_s = sum(a["duration_s"] or 0 for a in agents)
    span_s = round((max(ends) - min(starts)).total_seconds(), 1) if starts and ends else None
    active_s = active_union_seconds(agents)

    totals = Counter()
    for a in agents:
        for k, v in a["tokens"].items():
            totals[k] += v
    weighted_total = sum(a["weighted_input_tokens"] for a in agents)
    priced = [a for a in agents if a["cost_usd"] is not None]
    unpriced = sorted({a["model"] for a in agents if a["cost_usd"] is None and a["model"]})

    for a in agents:
        a.pop("_start", None)
        a.pop("_end", None)

    print(
        json.dumps(
            {
                "session_id": sid,
                "project": str(Path(args.cwd).resolve()),
                "agent_count": len(agents),
                "launch_order": [a["description"] or a["agent_id"] for a in agents],
                "spawn_records": parent_spawns(pdir, sid),
                "wall": {
                    "first_start_to_last_end_s": span_s,
                    "active_s": active_s,
                    "idle_gap_s": round(span_s - active_s, 1)
                    if span_s is not None
                    else None,
                    "sum_agent_seconds": round(sum_s, 1),
                    # sum / active, not sum / span: idle gaps between phases are not
                    # serialization and must not be scored as if they were.
                    "parallelism": round(sum_s / active_s, 2) if active_s else None,
                    "clusters": clusters,
                },
                "tokens": {
                    **dict(totals),
                    "weighted_input_tokens": weighted_total,
                    "multipliers": {
                        "cache_read": CACHE_READ_MULT,
                        "cache_write_5m": CACHE_WRITE_5M_MULT,
                        "cache_write_1h": CACHE_WRITE_1H_MULT,
                    },
                },
                "cost": {
                    "usd_priced_agents": round(sum(a["cost_usd"] for a in priced), 4)
                    if priced
                    else None,
                    "priced_agents": len(priced),
                    "unpriced_agents": len(agents) - len(priced),
                    "unpriced_models": unpriced,
                },
                "duplicated_grounding": {
                    "files": dup_rows,
                    "est_redundant_tokens": dup_tokens,
                },
                "friction": {
                    "denied_tool_calls_in_agents": sum(a["denied_tool_calls"] for a in agents),
                    "denied_tool_calls_in_parent": parent_denials(pdir, sid),
                    "tool_errors": sum(a["tool_errors"] for a in agents),
                    "agents_rereading_a_file": [
                        {"agent": a["description"], "rereads": a["reread_within_agent"]}
                        for a in agents
                        if a["reread_within_agent"]
                    ],
                },
                "agents": agents,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
