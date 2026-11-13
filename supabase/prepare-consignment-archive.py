"""Prepare a private, offline import from invoice PDFs, summaries and BudgetFlow.

Use the workspace Python which provides pypdf. The originals stay unchanged.
"""

import argparse
import csv
import hashlib
import json
import os
import re
import sys
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader


ITALIAN_MONTHS = (
    "gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre"
).split()
PDF_NAME = re.compile(r"[A-Za-z0-9_.-]{1,180}\.pdf", re.IGNORECASE)
MONEY = re.compile(r"€\s*([\d.,]+)")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def cents(value):
    amount = Decimal(value) * 100
    require(amount.is_finite() and amount == amount.to_integral() and abs(amount) <= 9000000000000000,
            "Importo fuori intervallo o con più di due decimali.")
    return int(amount)


def pdf_cents(value):
    return cents(value.replace(".", "").replace(",", ".") if "," in value else value)


def read_pdf(path):
    require(not path.is_symlink() and len(path.name) <= 180 and bool(PDF_NAME.fullmatch(path.name)),
            "Nome PDF non valido.")
    require(0 < path.stat().st_size <= 25 * 1024**2, "Dimensione PDF non valida.")
    raw = path.read_bytes()
    require(raw.startswith(b"%PDF-"), "Originale PDF non valido.")
    sha256 = hashlib.sha256(raw).hexdigest()
    pdf = PdfReader(BytesIO(raw))
    require(not pdf.is_encrypted and len(pdf.pages) > 0, "PDF senza testo estraibile.")
    return (
        "\n".join(page.extract_text() or "" for page in pdf.pages),
        dict(file_name=path.name, storage_path=f"sources/{sha256}/{path.name}", sha256=sha256, byte_size=len(raw)),
        raw,
    )


def invoice_period(text):
    dated_periods = re.findall(
        r"periodo\s+dal\s+(\d{1,2}/\d{1,2}/\d{4})\s+al\s+(\d{1,2}/\d{1,2}/\d{4})", text, re.IGNORECASE,
    )
    if dated_periods:
        dates = {tuple(datetime.strptime(item, "%d/%m/%Y").date() for item in pair) for pair in dated_periods}
        require(len(dates) == 1, "Periodi discordanti nella fattura.")
        start, end = dates.pop()
        return start, end, False

    months = "|".join(ITALIAN_MONTHS)
    periods = set(re.findall(
        rf"periodo\s+({months})\s*[-–]\s*(\d{{1,2}})\s+({months})\s+(\d{{4}})", text.lower(),
    ))
    require(len(periods) == 1, "Periodo di vendita non leggibile dalla fattura.")
    first, last_day, last, year = periods.pop()
    first_month, last_month = ITALIAN_MONTHS.index(first) + 1, ITALIAN_MONTHS.index(last) + 1
    start = date(int(year) - (first_month > last_month), first_month, 1)
    return start, date(int(year), last_month, int(last_day)), True


def statement_lines(text):
    heading, marker, body = text.partition("RIEPILOGO CAPI VENDUTI")
    require(bool(marker), "Riepilogo dei capi assente.")
    number = re.search(r"ALLEGATO\s+FATTURA\s+N\.\s*(\d+)", heading, re.IGNORECASE)
    require(number is not None, "Numero fattura assente dal riepilogo.")
    headers, marker, body = body.partition("Spettanza (60%)")
    detail, total_marker, totals = body.partition("TOTALE")
    require(bool(marker and total_marker), "Intestazioni del riepilogo incomplete.")
    has_color = "Colore" in headers.split()
    fields_per_row = 7 if has_color else 6
    fields = [line.strip() for line in detail.splitlines() if line.strip()]
    printed_pieces = None
    if len(fields) % fields_per_row == 1 and fields[-1].isdigit():
        printed_pieces = int(fields.pop())
    require(len(fields) >= fields_per_row and len(fields) % fields_per_row == 0,
            "Righe del riepilogo incomplete.")
    lines = []
    for offset in range(0, len(fields), fields_per_row):
        fields_for_line = fields[offset:offset + fields_per_row]
        if has_color:
            model, color, *values = fields_for_line
            model = f"{model} {color}"
        else:
            model, *values = fields_for_line
        size, qty, *prices = values
        money = [MONEY.fullmatch(item) for item in prices]
        require(qty.isdigit() and int(qty) > 0 and all(money), "Riga del riepilogo malformata.")
        unit, gross, brand = [pdf_cents(item.group(1)) for item in money]
        require(int(qty) * unit == gross and (gross * 60 + 50) // 100 == brand,
                "Importi di riga del riepilogo discordanti.")
        lines.append(dict(model=model, size=size, quantity=int(qty), unit_cents=unit, gross_cents=gross, brand_cents=brand))
    pieces = sum(item["quantity"] for item in lines)
    gross = sum(item["gross_cents"] for item in lines)
    brand = sum(item["brand_cents"] for item in lines)
    require(printed_pieces in (None, pieces) and [pdf_cents(item) for item in MONEY.findall(totals)] == [gross, brand],
            "Totali del riepilogo discordanti.")
    return number[1], lines, pieces, gross, brand


def matching_payment(rows, party, brand, invoice_date):
    matches = []
    for row in rows:
        tags = re.findall(r"'([^']+)'", row["Tags"])
        has_party = party.casefold() in [tag.strip().casefold() for tag in tags]
        if (has_party and row["Category"] == "Vendite" and row["Source Currency"] == "EUR"
                and not row["Target Account"] and cents(row["Amount"]) == brand
                and date.fromisoformat(row["Date"][:10]) >= invoice_date):
            matches.append(row)
    require(len(matches) == 1, "Pagamento BudgetFlow assente o ambiguo: verifica la fonte.")
    return matches[0]


def stage(args):
    root = (Path(__file__).resolve().parent.parent / ".private").resolve()
    output = args.output.absolute()
    require(output.parent.resolve().is_relative_to(root) and not output.exists() and not output.is_symlink(),
            "Usa una nuova cartella di output sotto .private.")
    require(re.fullmatch(r"[A-Z0-9]{2,12}", args.shop_code), "Codice negozio non valido.")
    require(args.party.strip() and len(args.party) <= 240, "Etichetta BudgetFlow non valida.")
    require(args.invoice_dir.is_dir(), "Cartella fatture non disponibile.")
    require(args.budgetflow_csv.stat().st_size <= 10 * 1024**2, "Export BudgetFlow oltre 10 MiB.")
    with args.budgetflow_csv.open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))

    entries = []
    documents = {}
    invoice_paths = sorted(args.invoice_dir.rglob("Fattura*.pdf"))
    require(bool(invoice_paths), "Nessuna fattura da archiviare.")
    for invoice in invoice_paths:
        text, invoice_meta, invoice_bytes = read_pdf(invoice)
        flattened = " ".join(text.split())
        invoice_head = re.search(r"Fattura\s+Numero:\s*(\d+)\s+(\d{2}\.\d{2}\.\d{4})", flattened)
        invoice_total = re.search(r"TOTALE\s+([\d.,]+)\s*\(EUR\)", flattened)
        require(invoice_head and invoice_total and args.party.casefold() in flattened.casefold(),
                "Numero, totale o destinatario della fattura non verificabile.")
        invoice_date = datetime.strptime(invoice_head[2], "%d.%m.%Y").date()
        start, end, month_only = invoice_period(flattened)
        require(start <= end <= invoice_date <= args.reference_date, "Periodo della fattura non valido.")
        statement = invoice.with_name(f"allegato_fattura_{invoice_head[1]}.pdf")
        text, statement_meta, statement_bytes = read_pdf(statement)
        number, lines, pieces, gross, brand = statement_lines(text)
        require(invoice_head[1] == number and pdf_cents(invoice_total[1]) == brand,
                "Fattura e riepilogo non concordano.")
        payment = matching_payment(rows, args.party, brand, invoice_date)
        payment_references = re.findall(r"\bfattura(?:\s*n(?:\.|r\.?|°))?\s*\.?\s*(\d+)",
                                        f"{payment['Notes']} {payment['Tags']}", re.IGNORECASE)
        mismatch = any(reference != number for reference in payment_references)
        entries.append(dict(shop_code=args.shop_code, invoice_number=number, invoice_date=str(invoice_date),
                            period_start=str(start), period_end=str(end), period_start_month_only=month_only,
                            pieces=pieces, gross_cents=gross, brand_cents=brand, sale_lines=lines,
                            consignment_invoice=invoice_meta, consignment_statement=statement_meta,
                            payment_raw=payment, payment_reference_mismatch=mismatch,
                            reference_date=str(args.reference_date)))
        documents[invoice_meta["storage_path"]] = invoice_bytes
        documents[statement_meta["storage_path"]] = statement_bytes

    ordered = sorted(entries, key=lambda row: row["period_start"])
    require(len(documents) == 2 * len(entries)
            and len({json.dumps(row["payment_raw"], sort_keys=True) for row in entries}) == len(entries)
            and all(left["period_end"] < right["period_start"] for left, right in zip(ordered, ordered[1:])),
            "Originali duplicati, pagamenti riutilizzati o periodi sovrapposti.")

    output.mkdir(mode=0o700, parents=True)
    for relative, raw in documents.items():
        path = output / relative
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with path.open("xb") as file:
            file.write(raw)
        path.chmod(0o600)

    literals = [json.dumps(entry, ensure_ascii=False).replace("'", "''") for entry in ordered]
    sql = ["begin;", "set local standard_conforming_strings = on;"]
    sql.extend(f"select private.import_finance_consignment_archive('{literal}'::jsonb);" for literal in literals)
    sql.append("commit;")
    for name, content in [("conto-vendita.sql", "\n".join(sql) + "\n"),
                          ("originali.json", json.dumps(sorted(documents), indent=2) + "\n")]:
        path = output / name
        path.write_text(content, encoding="utf-8")
        path.chmod(0o600)
    return len(entries), len(documents)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--invoice-dir", type=Path, required=True)
    parser.add_argument("--budgetflow-csv", type=Path, required=True)
    parser.add_argument("--shop-code", required=True)
    parser.add_argument("--party", required=True, help="Tag esatto del negozio in BudgetFlow")
    parser.add_argument("--reference-date", type=date.fromisoformat, required=True)
    parser.add_argument("--output", type=Path, required=True)
    os.umask(0o077)
    try:
        entries, documents = stage(parser.parse_args())
    except Exception as error:
        message = error.args[0] if type(error) is ValueError else "Leggere PDF, CSV e output non riuscito."
        sys.exit(message)
    print(f"Staging privato pronto. {entries} fatture, {documents} originali verificati.")
