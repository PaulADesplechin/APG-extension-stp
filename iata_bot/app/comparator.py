"""
APG BSPLink Bot — CSV Comparison Logic
Compares eBulletin CSV (uploaded by user) with BSPLink data (scraped per country).
"""

import csv
import io
import re
import logging

logger = logging.getLogger("comparator")

# eBulletin sections and their expected BSPLink actions
SECTION_RULES = {
    "TERMINATIONS": "Disabled",
    "REINSTATEMENTS": "Enabled",
    "NEW APPLICATIONS": None,  # Not expected in BSPLink yet
    "IRREGULARITIES AND ADMIN NONCOMPLIANCE": None,  # Manual check
}


def clean_agent_code(raw: str) -> str:
    """Clean eBulletin agent code format: =\"12345678\" → 12345678"""
    if not raw:
        return ""
    # Remove ="" wrapping: ="12345678" or =""12345678""
    cleaned = raw.strip()
    cleaned = re.sub(r'^[="]+', '', cleaned)
    cleaned = re.sub(r'[="]+$', '', cleaned)
    cleaned = cleaned.strip()
    return cleaned


def parse_ebulletin_csv(file_content: str | bytes) -> list[dict]:
    """Parse the eBulletin CSV uploaded by the user.
    Returns list of dicts with cleaned fields."""

    if isinstance(file_content, bytes):
        file_content = file_content.decode("utf-8", errors="replace")

    reader = csv.DictReader(io.StringIO(file_content))
    rows = []

    for row in reader:
        # Normalize column names (strip spaces, lowercase for matching)
        normalized = {}
        for k, v in row.items():
            if k is None:
                continue
            normalized[k.strip()] = (v or "").strip()

        # Find the agent code column (may be "Agency Code", "Agent Code", etc.)
        agent_code = ""
        for key in ["Agency Code", "Agent Code", "AgencyCode", "IATA Code"]:
            if key in normalized:
                agent_code = clean_agent_code(normalized[key])
                break

        # Find the section column
        section = ""
        for key in ["Section", "SECTION"]:
            if key in normalized:
                section = normalized[key].strip().upper()
                break

        # Find change code
        change_code = ""
        for key in ["Change Code", "ChangeCode", "CHANGE CODE"]:
            if key in normalized:
                change_code = normalized[key].strip()
                break

        # Find country
        country = ""
        for key in ["Country or State", "Country", "COUNTRY"]:
            if key in normalized:
                country = normalized[key].strip()
                break

        # Find agency name
        agency_name = ""
        for key in ["Agency Name", "Agent Name", "Name"]:
            if key in normalized:
                agency_name = normalized[key].strip()
                break

        if agent_code:
            rows.append({
                "agent_code": agent_code,
                "section": section,
                "change_code": change_code,
                "country": country,
                "agency_name": agency_name,
                "raw": normalized
            })

    logger.info(f"Parsed {len(rows)} rows from eBulletin")
    return rows


def compare_country(
    bsplink_rows: list[dict],
    ebulletin_rows: list[dict],
    country_code: str
) -> list[dict]:
    """Compare BSPLink data with eBulletin data for a single country.

    Args:
        bsplink_rows: Rows from BSPLink Ticketing Authority History CSV
        ebulletin_rows: ALL rows from eBulletin (we filter by country)
        country_code: BSP country code (e.g. "CH", "FR")

    Returns:
        List of result dicts with Discrepancy column
    """
    results = []

    # Build BSPLink lookup: agent_code → latest action (Enabled/Disabled)
    # BSPLink CSV columns: BSP | Agent Code | Agent Name | Date/Time | Action | Performed by | Email
    bsp_lookup = {}
    for row in bsplink_rows:
        # Find agent code column
        code = ""
        for key in ["Agent Code", "AgentCode", "AGENT CODE", "agent_code"]:
            if key in row:
                code = row[key].strip()
                break
        if not code:
            # Try first column that looks like a code
            for k, v in row.items():
                if v and re.match(r'^\d{7,8}$', v.strip()):
                    code = v.strip()
                    break

        action = ""
        for key in ["Action", "ACTION", "action"]:
            if key in row:
                action = row[key].strip()
                break

        agent_name = ""
        for key in ["Agent Name", "AgentName", "AGENT NAME"]:
            if key in row:
                agent_name = row[key].strip()
                break

        if code:
            # Keep the latest action (last entry wins)
            bsp_lookup[code] = {
                "action": action,
                "agent_name": agent_name,
                "raw": row
            }

    # Filter eBulletin rows for this country (by country code or name)
    country_bulletin = [
        r for r in ebulletin_rows
        if country_code.upper() in (r.get("country", "") or "").upper()
    ]

    # If no country match, try matching all bulletin rows against BSP codes
    if not country_bulletin:
        # Try matching by agent codes present in BSPLink
        bsp_codes = set(bsp_lookup.keys())
        country_bulletin = [
            r for r in ebulletin_rows
            if r.get("agent_code", "") in bsp_codes
        ]

    logger.info(f"Country {country_code}: {len(bsp_lookup)} BSPLink agents, {len(country_bulletin)} eBulletin matches")

    # Track which BSPLink codes are matched
    matched_bsp_codes = set()

    # Process each eBulletin entry
    for eb_row in country_bulletin:
        agent_code = eb_row["agent_code"]
        section = eb_row["section"]
        change_code = eb_row.get("change_code", "")
        agency_name = eb_row.get("agency_name", "")

        bsp_data = bsp_lookup.get(agent_code)
        matched_bsp_codes.add(agent_code)

        result = {
            "BSP": country_code,
            "Agent Code": agent_code,
            "Agent Name": agency_name,
            "eBulletin Section": section,
            "Change Code": change_code,
            "Country": eb_row.get("country", ""),
        }

        if "NEW APPLICATION" in section:
            result["BSPLink Action"] = bsp_data["action"] if bsp_data else "N/A"
            result["Discrepancy"] = "NEW APPLICATION"

        elif "IRREGULARIT" in section or "NONCOMPLIANCE" in section:
            result["BSPLink Action"] = bsp_data["action"] if bsp_data else "N/A"
            result["Discrepancy"] = "CHECK MANUALLY"

        elif "TERMINATION" in section:
            if bsp_data:
                result["BSPLink Action"] = bsp_data["action"]
                if bsp_data["action"].upper() == "DISABLED":
                    result["Discrepancy"] = "OK"
                else:
                    result["Discrepancy"] = "MISMATCH"
            else:
                result["BSPLink Action"] = "NOT FOUND"
                result["Discrepancy"] = "MISMATCH"

        elif "REINSTATEMENT" in section:
            if bsp_data:
                result["BSPLink Action"] = bsp_data["action"]
                if bsp_data["action"].upper() == "ENABLED":
                    result["Discrepancy"] = "OK"
                else:
                    result["Discrepancy"] = "MISMATCH"
            else:
                result["BSPLink Action"] = "NOT FOUND"
                result["Discrepancy"] = "MISMATCH"

        else:
            # Unknown section
            result["BSPLink Action"] = bsp_data["action"] if bsp_data else "N/A"
            result["Discrepancy"] = "CHECK MANUALLY"

        results.append(result)

    # Add BSPLink entries NOT in eBulletin
    for code, bsp_data in bsp_lookup.items():
        if code not in matched_bsp_codes:
            results.append({
                "BSP": country_code,
                "Agent Code": code,
                "Agent Name": bsp_data.get("agent_name", ""),
                "eBulletin Section": "",
                "Change Code": "",
                "Country": country_code,
                "BSPLink Action": bsp_data["action"],
                "Discrepancy": "NOT IN BULLETIN"
            })

    return results


def compare_all_countries(
    bsplink_data: dict[str, list[dict]],
    ebulletin_rows: list[dict]
) -> dict[str, list[dict]]:
    """Compare all countries.

    Args:
        bsplink_data: {country_code: [bsplink_rows]}
        ebulletin_rows: All parsed eBulletin rows

    Returns:
        {country_code: [result_rows_with_discrepancy]}
    """
    all_results = {}

    for country_code, bsp_rows in bsplink_data.items():
        try:
            results = compare_country(bsp_rows, ebulletin_rows, country_code)
            all_results[country_code] = results
            logger.info(f"{country_code}: {len(results)} results")
        except Exception as e:
            logger.error(f"Error comparing {country_code}: {e}")
            all_results[country_code] = []

    return all_results
