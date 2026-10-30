"""Mind2Web parquet → steps.ndjson：只提取转换所需字段（跳过 raw_html 大列）。

用法：python extract_mind2web.py [parquetDir] [out.ndjson] [--limit N]
依赖：pyarrow（pip install pyarrow）
"""
import json
import sys
from pathlib import Path

import pyarrow.parquet as pq


def parse_rect(value: str | None):
    if not value:
        return None
    try:
        x, y, w, h = (float(v) for v in str(value).split(",")[:4])
        return {"x": x, "y": y, "w": w, "h": h}
    except (ValueError, TypeError):
        return None


def parse_candidate(raw: dict) -> dict:
    attrs = raw.get("attributes") or "{}"
    if isinstance(attrs, str):
        try:
            attrs = json.loads(attrs)
        except json.JSONDecodeError:
            attrs = {}
    return {
        "tag": raw.get("tag") or "",
        "backend_node_id": raw.get("backend_node_id"),
        "is_original_target": bool(raw.get("is_original_target")),
        "is_top_level_target": bool(raw.get("is_top_level_target")),
        "bbox": parse_rect(attrs.get("bounding_box_rect")),
        "id": attrs.get("id") or "",
        "name": attrs.get("name") or "",
        "class": attrs.get("class") or "",
    }


def iter_steps(parquet_dir: Path, limit: int):
    emitted = 0
    for file in sorted(parquet_dir.glob("*.parquet")):
        table = pq.read_table(
            file,
            columns=["website", "domain", "confirmed_task", "annotation_id", "action_reprs", "actions"],
        )
        for row in table.to_pylist():
            goal = row.get("confirmed_task") or ""
            for step_index, action in enumerate(row.get("actions") or []):
                pos = [parse_candidate(c) for c in (action.get("pos_candidates") or [])]
                neg = [parse_candidate(c) for c in (action.get("neg_candidates") or [])]
                operation = action.get("operation") or {}
                yield {
                    "goal": goal,
                    "website": row.get("website") or "",
                    "domain": row.get("domain") or "",
                    "annotationId": row.get("annotation_id") or "",
                    "stepIndex": step_index,
                    "actionRepr": (row.get("action_reprs") or [""] * (step_index + 1))[step_index]
                    if step_index < len(row.get("action_reprs") or [])
                    else "",
                    "operation": {
                        "op": operation.get("op") or operation.get("original_op") or "",
                        "value": operation.get("value") or "",
                    },
                    "posCandidates": pos,
                    "negCandidates": neg,
                    "cleanedHtml": action.get("cleaned_html") or "",
                }
                emitted += 1
                if limit and emitted >= limit:
                    return


def main() -> None:
    parquet_dir = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out_path = Path(sys.argv[2] if len(sys.argv) > 2 else "steps.ndjson")
    limit = 0
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])

    count = 0
    with out_path.open("w", encoding="utf-8") as out:
        for step in iter_steps(parquet_dir, limit):
            out.write(json.dumps(step, ensure_ascii=False) + "\n")
            count += 1
            if count % 500 == 0:
                print(f"  extracted {count} steps...", flush=True)
    print(f"done: {count} steps → {out_path}")


if __name__ == "__main__":
    main()
