#!/usr/bin/env python3
"""Gera vereadores_rj.json a partir do CSV oficial do TSE.

Fonte esperada:
https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_2024.zip
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


TSE_ZIP_URL = "https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_2024.zip"
CSV_NAME = "votacao_candidato_munzona_2024_RJ.csv"
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
OUTPUT_PATH = PROJECT_ROOT / "src" / "data" / "vereadores_rj.json"


def slugify(text: str) -> str:
    clean = unicodedata.normalize("NFKD", text)
    clean = clean.encode("ascii", "ignore").decode("ascii")
    clean = re.sub(r"[^a-zA-Z0-9]+", "-", clean.lower()).strip("-")
    return clean


def title_pt_br(text: str) -> str:
    small_words = {"da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "a", "o"}
    words = []
    for idx, word in enumerate((text or "").strip().split()):
        lower = word.lower()
        if idx > 0 and lower in small_words:
            words.append(lower)
        else:
            words.append(lower[:1].upper() + lower[1:])
    return " ".join(words)


def load_csv_text(zip_path: Path | None) -> str:
    if zip_path is None:
        with urllib.request.urlopen(TSE_ZIP_URL, timeout=90) as response:
            raw_zip = response.read()
    else:
        raw_zip = zip_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as archive:
        return archive.read(CSV_NAME).decode("latin-1")


def gerar_payload(csv_text: str) -> dict[str, Any]:
    vereadores: dict[str, dict[str, Any]] = {}
    votos_por_candidato: defaultdict[str, int] = defaultdict(int)
    reader = csv.DictReader(io.StringIO(csv_text), delimiter=";")

    for row in reader:
        if row.get("CD_CARGO") != "13":
            continue
        situacao = row.get("DS_SIT_TOT_TURNO", "")
        if situacao not in {"ELEITO POR QP", "ELEITO POR MÉDIA"}:
            continue

        sq = row["SQ_CANDIDATO"]
        votos_por_candidato[sq] += int(row.get("QT_VOTOS_NOMINAIS_VALIDOS") or 0)
        if sq in vereadores:
            continue

        cidade = title_pt_br(row["NM_MUNICIPIO"])
        nome_urna = title_pt_br(row["NM_URNA_CANDIDATO"])
        vereadores[sq] = {
            "nome": nome_urna,
            "slug": slugify(nome_urna),
            "cidade": cidade,
            "cidadeSlug": slugify(cidade),
            "partido": row["SG_PARTIDO"],
            "numero": row["NR_CANDIDATO"],
            "situacao": situacao,
        }

    cidades: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for sq, item in vereadores.items():
        item["votosNominaisValidos"] = votos_por_candidato[sq]
        cidades[item["cidade"]].append(item)

    cidades_payload = []
    for cidade in sorted(cidades):
        itens = sorted(cidades[cidade], key=lambda x: (-x["votosNominaisValidos"], x["nome"]))
        cidades_payload.append(
            {
                "cidade": cidade,
                "cidadeSlug": slugify(cidade),
                "total": len(itens),
                "vereadores": itens,
            }
        )

    return {
        "fonte": TSE_ZIP_URL,
        "arquivo": CSV_NAME,
        "geradoEm": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "criterio": "CD_CARGO=13; DS_SIT_TOT_TURNO em ELEITO POR QP ou ELEITO POR MÉDIA; agregado por SQ_CANDIDATO.",
        "totais": {
            "municipios": len(cidades_payload),
            "vereadores": sum(cidade["total"] for cidade in cidades_payload),
        },
        "cidades": cidades_payload,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", type=Path, help="Zip local do TSE; se omitido, baixa da fonte oficial.")
    parser.add_argument("--out", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()

    payload = gerar_payload(load_csv_text(args.zip))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload["totais"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
