#!/usr/bin/env python3
"""Gate de segurança do Semgrep: falha se houver achado de risco ALTO ou CRÍTICO.

As regras OSS do Semgrep têm só 3 severidades (INFO, WARNING, ERROR), mas
trazem `likelihood` e `impact` nos metadados. O risco é calculado pela matriz
da OWASP Risk Rating Methodology:

                    impacto BAIXO  impacto MÉDIO  impacto ALTO
  prob. BAIXA       NOTA           BAIXO          MÉDIO
  prob. MÉDIA       BAIXO          MÉDIO          ALTO
  prob. ALTA        MÉDIO          ALTO           CRÍTICO

Severidade ERROR é sempre tratada como ALTO (no mínimo).

Uso: semgrep_gate.py semgrep.json   (exit 1 = bloqueia o pipeline)
"""
import json
import os
import sys

NIVEIS = ["NOTA", "BAIXO", "MÉDIO", "ALTO", "CRÍTICO"]
MATRIZ = {
    ("LOW", "LOW"): "NOTA", ("LOW", "MEDIUM"): "BAIXO", ("LOW", "HIGH"): "MÉDIO",
    ("MEDIUM", "LOW"): "BAIXO", ("MEDIUM", "MEDIUM"): "MÉDIO", ("MEDIUM", "HIGH"): "ALTO",
    ("HIGH", "LOW"): "MÉDIO", ("HIGH", "MEDIUM"): "ALTO", ("HIGH", "HIGH"): "CRÍTICO",
}
BLOQUEIA = {"ALTO", "CRÍTICO"}


def risco(achado: dict) -> str:
    extra = achado.get("extra", {})
    meta = extra.get("metadata") or {}
    prob = str(meta.get("likelihood", "")).upper()
    impacto = str(meta.get("impact", "")).upper()
    nivel = MATRIZ.get((prob, impacto))
    if nivel is None:  # regra sem metadados: usa a severidade do Semgrep
        nivel = {"ERROR": "ALTO", "WARNING": "MÉDIO"}.get(extra.get("severity", ""), "BAIXO")
    if extra.get("severity") == "ERROR" and NIVEIS.index(nivel) < NIVEIS.index("ALTO"):
        nivel = "ALTO"
    return nivel


def main() -> int:
    if len(sys.argv) != 2:
        print("uso: semgrep_gate.py <semgrep.json>", file=sys.stderr)
        return 2
    with open(sys.argv[1], encoding="utf-8") as f:
        relatorio = json.load(f)

    if relatorio.get("errors"):
        # Erro de parse/regra não bloqueia sozinho, mas fica visível no log.
        print(f"aviso: o Semgrep reportou {len(relatorio['errors'])} erro(s) de execução")

    linhas, bloqueantes = [], 0
    for achado in relatorio.get("results", []):
        nivel = risco(achado)
        bloqueia = nivel in BLOQUEIA
        bloqueantes += bloqueia
        regra = achado.get("check_id", "?").split(".")[-1]
        local = f"{achado.get('path')}:{achado.get('start', {}).get('line')}"
        linhas.append(f"| {'❌' if bloqueia else '⚠️'} {nivel} | `{regra}` | `{local}` |")

    total = len(linhas)
    resumo = [
        "### Semgrep (SAST)",
        f"{total} achado(s), {bloqueantes} de risco ALTO/CRÍTICO (bloqueante).",
    ]
    if linhas:
        resumo += ["", "| Risco | Regra | Local |", "|---|---|---|", *linhas]
    texto = "\n".join(resumo)
    print(texto)

    destino = os.environ.get("GITHUB_STEP_SUMMARY")
    if destino:
        with open(destino, "a", encoding="utf-8") as f:
            f.write(texto + "\n")

    return 1 if bloqueantes else 0


if __name__ == "__main__":
    sys.exit(main())
