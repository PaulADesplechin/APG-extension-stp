"""
APG BSPLink Bot — Flask Web Interface
Simple localhost interface for Cristelle to:
  1. Upload eBulletin CSV
  2. Launch the bot
  3. See progress
  4. Download the final Excel report
"""

import asyncio
import json
import logging
import os
import sys
import threading
import webbrowser
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_file

# Add parent dir to path
sys.path.insert(0, str(Path(__file__).parent))
from bot import BSPLinkBot
from comparator import parse_ebulletin_csv, compare_all_countries
from exporter import generate_report

# ---- Config ----
BASE_DIR = Path(__file__).parent.parent
OUTPUT_DIR = BASE_DIR / "output"
UPLOAD_DIR = BASE_DIR / "uploads"
TEMPLATE_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

OUTPUT_DIR.mkdir(exist_ok=True)
UPLOAD_DIR.mkdir(exist_ok=True)

# ---- Logging ----
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(str(BASE_DIR / "errors.log"), encoding="utf-8")
    ]
)
logger = logging.getLogger("main")

# ---- Flask App ----
app = Flask(
    __name__,
    template_folder=str(TEMPLATE_DIR),
    static_folder=str(STATIC_DIR)
)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50MB max

# ---- Global State ----
bot_state = {
    "status": "idle",      # idle, running, done, error
    "stage": "",
    "message": "",
    "percent": 0,
    "country": "",
    "current": 0,
    "total": 0,
    "errors": [],
    "report_path": None,
    "ebulletin_path": None,
}


def update_progress(**kwargs):
    """Callback for bot to update progress."""
    for k, v in kwargs.items():
        if k in bot_state:
            bot_state[k] = v


# ---- Routes ----

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():
    """Upload eBulletin CSV."""
    if "file" not in request.files:
        return jsonify({"error": "Aucun fichier selectionne"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Aucun fichier selectionne"}), 400

    # Save the file
    filename = file.filename
    filepath = str(UPLOAD_DIR / filename)
    file.save(filepath)

    bot_state["ebulletin_path"] = filepath
    logger.info(f"eBulletin uploaded: {filepath}")

    return jsonify({"success": True, "filename": filename})


@app.route("/start", methods=["POST"])
def start():
    """Start the bot."""
    if bot_state["status"] == "running":
        return jsonify({"error": "Le bot est deja en cours d'execution"}), 400

    if not bot_state.get("ebulletin_path"):
        return jsonify({"error": "Uploadez d'abord le fichier eBulletin CSV"}), 400

    # Reset state
    bot_state.update({
        "status": "running",
        "stage": "starting",
        "message": "Demarrage...",
        "percent": 0,
        "country": "",
        "current": 0,
        "total": 0,
        "errors": [],
        "report_path": None,
    })

    # Run bot in background thread
    thread = threading.Thread(target=_run_bot, daemon=True)
    thread.start()

    return jsonify({"success": True})


@app.route("/progress")
def progress():
    """Get current bot progress."""
    return jsonify(bot_state)


@app.route("/download")
def download():
    """Download the final Excel report."""
    if not bot_state.get("report_path"):
        return jsonify({"error": "Aucun rapport disponible"}), 404

    path = bot_state["report_path"]
    if not os.path.exists(path):
        return jsonify({"error": "Fichier introuvable"}), 404

    return send_file(
        path,
        as_attachment=True,
        download_name=os.path.basename(path)
    )


# ---- Bot execution ----

def _run_bot():
    """Run the bot in a background thread with its own event loop."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        loop.run_until_complete(_run_bot_async())
    except Exception as e:
        logger.error(f"Bot crashed: {e}", exc_info=True)
        bot_state.update({
            "status": "error",
            "message": f"Erreur: {str(e)}",
        })
    finally:
        loop.close()


async def _run_bot_async():
    """Async bot execution."""
    bot = BSPLinkBot(progress_callback=update_progress)

    try:
        # Connect to Chrome
        bot_state.update({"stage": "connecting", "message": "Connexion a Chrome...", "percent": 1})
        await bot.connect()

        # Navigate to BSPLink
        bot_state.update({"stage": "bsplink", "message": "Navigation vers BSP Link...", "percent": 3})
        await bot.navigate_to_bsplink()

        # Handle user selection
        bot_state.update({"stage": "user_select", "message": "Selection du compte...", "percent": 5})
        await bot.handle_user_selection()

        # Get country list
        bot_state.update({"stage": "countries", "message": "Recuperation des pays...", "percent": 8})
        await bot.get_country_list()
        bot_state["total"] = len(bot.countries)

        if not bot.countries:
            raise RuntimeError("Aucun pays trouve")

        logger.info(f"Found {len(bot.countries)} countries")

        # Process all countries (scraping)
        bsplink_data = await bot.process_all_countries()

        # Parse eBulletin
        bot_state.update({"stage": "comparing", "message": "Comparaison des donnees...", "percent": 96})
        with open(bot_state["ebulletin_path"], "r", encoding="utf-8", errors="replace") as f:
            ebulletin_content = f.read()
        ebulletin_rows = parse_ebulletin_csv(ebulletin_content)

        # Compare
        all_results = compare_all_countries(bsplink_data, ebulletin_rows)

        # Generate Excel
        bot_state.update({"stage": "report", "message": "Generation du rapport Excel...", "percent": 98})
        report_path = generate_report(all_results, str(OUTPUT_DIR))

        # Count mismatches
        total_mismatches = sum(
            1 for rows in all_results.values()
            for r in rows if r.get("Discrepancy") == "MISMATCH"
        )

        bot_state.update({
            "status": "done",
            "stage": "done",
            "message": f"Termine ! {total_mismatches} anomalies detectees sur {len(bot.countries)} pays.",
            "percent": 100,
            "report_path": report_path,
            "errors": bot.errors,
        })

        logger.info(f"Bot completed. Report: {report_path}")

    except Exception as e:
        logger.error(f"Bot error: {e}", exc_info=True)
        bot_state.update({
            "status": "error",
            "message": str(e),
            "errors": bot.errors if hasattr(bot, "errors") else [],
        })
        raise
    finally:
        await bot.close()


# ---- Main ----

if __name__ == "__main__":
    port = 5050
    logger.info(f"Starting APG Assistant on http://localhost:{port}")

    # Open browser after a short delay
    def open_browser():
        import time
        time.sleep(1.5)
        webbrowser.open(f"http://localhost:{port}")

    threading.Thread(target=open_browser, daemon=True).start()

    app.run(host="127.0.0.1", port=port, debug=False)
