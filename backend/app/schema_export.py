"""Export the JSON Schema of the annotation document (single source of truth)."""

from __future__ import annotations

import json
from pathlib import Path

from .schema import Document


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    target = root / "docs" / "annotations.schema.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    schema = Document.model_json_schema(by_alias=True)
    target.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
