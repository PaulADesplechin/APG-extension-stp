"""
APG BSPLink Bot — Playwright automation
Connects to an already-open Chrome via CDP (port 9222).
Navigates BSPLink, switches countries, downloads Ticketing Authority CSVs.
"""

import asyncio
import csv
import io
import os
import zipfile
import tempfile
import logging
from pathlib import Path
from playwright.async_api import async_playwright, Page, BrowserContext

logger = logging.getLogger("bot")

# Selectors (from the recorded session)
SEL = {
    # Step 1: Click BSP Link card on portal
    "bsp_link_card": "div.slds-m-horizontal_x-large > slot > span > div > div > div:nth-of-type(1) div:nth-of-type(1) > article",

    # Step 2: User selection dialog
    "user_radio_first": '#user-select-dialog input[type="radio"]',
    "user_submit": '#user-select-dialog button',
    "user_submit_confirm": '#user-select-dialog bspl-user-selection-dialog div:nth-of-type(3) button:first-of-type',

    # Step 3: Globe icon (switch account)
    "globe_icon": "bspl-header li:nth-of-type(2) > a",

    # Country dropdown in switch dialog
    "country_dropdown": "div.dialog-container > div:nth-of-type(1) div.ng-input",
    "country_options": "ng-select .ng-dropdown-panel .ng-option",

    # Cancel / Apply buttons in switch dialog
    "switch_cancel": "bspl-dialog bspl-button:nth-of-type(1) button",
    "switch_apply": "bspl-dialog bspl-button:nth-of-type(2) button",

    # Step 4a: Master Data nav
    "master_data_nav": "text=MASTER DATA",
    "ticketing_authority": "text=Ticketing Authority",

    # Step 4b: Download
    "download_btn": "button:has-text('DOWNLOAD'), button:has-text('Download'), [class*='download'] button",
    "csv_radio": "text=CSV",
    "download_confirm": "bspl-dialog button:has-text('DOWNLOAD'), bspl-dialog button:has-text('Download')",

    # Table
    "datatable_row": "ngx-datatable .datatable-body-row",
}

TIMEOUT = 30_000  # 30 seconds
MAX_RETRIES = 2


class BSPLinkBot:
    """Automates BSPLink navigation and data extraction."""

    def __init__(self, progress_callback=None):
        self.page: Page = None
        self.context: BrowserContext = None
        self.playwright = None
        self.browser = None
        self.countries: list[dict] = []  # [{name: "SWITZERLAND - CH", code: "CH"}, ...]
        self.progress_callback = progress_callback or (lambda **kw: None)
        self.download_dir = tempfile.mkdtemp(prefix="apg_downloads_")
        self.errors: list[dict] = []
        self.results: dict[str, list[dict]] = {}  # country_code -> rows

    async def connect(self):
        """Connect to existing Chrome via CDP."""
        self.playwright = await async_playwright().start()
        try:
            self.browser = await self.playwright.chromium.connect_over_cdp(
                "http://localhost:9222"
            )
        except Exception as e:
            raise ConnectionError(
                f"Impossible de se connecter a Chrome. "
                f"Avez-vous lance START_CHROME.sh ? Erreur: {e}"
            )

        # Get existing browser context and page
        contexts = self.browser.contexts
        if not contexts:
            raise ConnectionError("Aucun onglet Chrome ouvert. Ouvrez Chrome et connectez-vous a portal.iata.org")

        self.context = contexts[0]
        pages = self.context.pages
        if not pages:
            raise ConnectionError("Aucune page ouverte dans Chrome.")

        # Find the portal page or the first page
        self.page = None
        for p in pages:
            if "portal.iata.org" in (p.url or ""):
                self.page = p
                break
            if "bsplink" in (p.url or ""):
                self.page = p
                break

        if not self.page:
            self.page = pages[0]

        logger.info(f"Connected to Chrome. Current page: {self.page.url}")
        self.progress_callback(stage="connected", message="Connecte a Chrome", percent=0)

    async def close(self):
        """Clean up."""
        if self.playwright:
            await self.playwright.stop()

    # ================================================================
    # STEP 1: Navigate from portal to BSP Link
    # ================================================================
    async def navigate_to_bsplink(self):
        """Click BSP Link card on portal.iata.org."""
        self.progress_callback(stage="bsplink", message="Navigation vers BSP Link...", percent=2)

        url = self.page.url.lower()

        # If already on BSPLink, skip
        if "bsplink" in url:
            logger.info("Already on BSPLink")
            return

        # If on portal, click BSP Link card
        if "portal.iata.org" in url:
            logger.info("On portal — clicking BSP Link card")
            await self.page.wait_for_load_state("networkidle", timeout=TIMEOUT)

            # Wait for Favorite Services to load
            await self.page.wait_for_timeout(3000)

            # Try the exact selector first
            try:
                card = self.page.locator(SEL["bsp_link_card"])
                await card.wait_for(state="visible", timeout=10_000)
                await card.click()
            except Exception:
                # Fallback: find by text
                logger.info("Card selector failed, trying text match...")
                bsp_link = self.page.locator("text=BSP Link").first
                await bsp_link.click()

            # Wait for BSPLink to load (new tab or same tab redirect)
            await self.page.wait_for_timeout(3000)

            # Check if BSPLink opened in a new tab
            all_pages = self.context.pages
            for p in all_pages:
                if "bsplink" in (p.url or "").lower():
                    self.page = p
                    break

            await self.page.wait_for_load_state("networkidle", timeout=TIMEOUT)
            logger.info(f"Now on: {self.page.url}")
        else:
            raise RuntimeError(f"Page inattendue: {self.page.url}. Allez sur portal.iata.org d'abord.")

    # ================================================================
    # STEP 2: Handle user selection dialog
    # ================================================================
    async def handle_user_selection(self):
        """Handle the ISOC user selection popup if it appears."""
        self.progress_callback(stage="user_select", message="Selection du compte...", percent=5)

        try:
            # Wait for the dialog to appear (it may not always show)
            dialog = self.page.locator("#user-select-dialog")
            await dialog.wait_for(state="visible", timeout=8_000)
            logger.info("User selection dialog detected")

            # Click first radio button
            radio = self.page.locator(SEL["user_radio_first"]).first
            await radio.click()
            await self.page.wait_for_timeout(500)

            # Click Submit
            submit = self.page.locator(SEL["user_submit"]).first
            await submit.click()
            await self.page.wait_for_timeout(2000)

            # Second Submit dialog (may or may not appear)
            try:
                confirm = self.page.locator(SEL["user_submit_confirm"]).first
                await confirm.wait_for(state="visible", timeout=3_000)
                await confirm.click()
                logger.info("Second submit dialog handled")
            except Exception:
                logger.info("No second submit dialog")

            await self.page.wait_for_load_state("networkidle", timeout=TIMEOUT)
            logger.info("User selection completed")

        except Exception:
            logger.info("No user selection dialog — skipping")

    # ================================================================
    # STEP 3: Get the full list of countries (once)
    # ================================================================
    async def get_country_list(self):
        """Open the globe/switch dialog and extract all available countries."""
        self.progress_callback(stage="countries", message="Recuperation de la liste des pays...", percent=8)

        await self.page.wait_for_load_state("networkidle", timeout=TIMEOUT)
        await self.page.wait_for_timeout(2000)

        # Click globe icon
        globe = self.page.locator(SEL["globe_icon"])
        await globe.wait_for(state="visible", timeout=TIMEOUT)
        await globe.click()
        await self.page.wait_for_timeout(2000)

        # Click country dropdown to open it
        dropdown = self.page.locator(SEL["country_dropdown"])
        await dropdown.wait_for(state="visible", timeout=TIMEOUT)
        await dropdown.click()
        await self.page.wait_for_timeout(1000)

        # Get all options
        options = self.page.locator(SEL["country_options"])
        count = await options.count()
        logger.info(f"Found {count} country options")

        self.countries = []
        for i in range(count):
            text = (await options.nth(i).inner_text()).strip()
            if not text:
                continue
            # Parse "SWITZERLAND - CH" → {name: "SWITZERLAND - CH", code: "CH"}
            parts = text.rsplit(" - ", 1)
            code = parts[-1].strip() if len(parts) > 1 else text[:2]
            self.countries.append({"name": text, "code": code, "index": i})

        logger.info(f"Countries extracted: {len(self.countries)}")

        # Close dialog without changing country — click Cancel
        try:
            cancel = self.page.locator(SEL["switch_cancel"])
            await cancel.click()
            await self.page.wait_for_timeout(1000)
        except Exception:
            # Press Escape as fallback
            await self.page.keyboard.press("Escape")
            await self.page.wait_for_timeout(1000)

        return self.countries

    # ================================================================
    # STEP 4a: Navigate to Master Data → Ticketing Authority History
    # ================================================================
    async def navigate_to_ticketing_authority(self):
        """Go to Master Data → Ticketing Authority History."""
        await self.page.wait_for_load_state("networkidle", timeout=TIMEOUT)
        await self.page.wait_for_timeout(1500)

        # Click MASTER DATA in nav
        master_data = self.page.locator(SEL["master_data_nav"]).first
        await master_data.wait_for(state="visible", timeout=TIMEOUT)
        await master_data.click()
        await self.page.wait_for_timeout(1500)

        # Click Ticketing Authority (in the sub-menu)
        ta = self.page.locator(SEL["ticketing_authority"]).first
        await ta.wait_for(state="visible", timeout=TIMEOUT)
        await ta.click()

        # Wait for the datatable to appear
        await self.page.wait_for_load_state("networkidle", timeout=TIMEOUT)
        await self.page.wait_for_timeout(3000)

        # Wait for table rows (or empty state)
        try:
            await self.page.locator(SEL["datatable_row"]).first.wait_for(
                state="visible", timeout=15_000
            )
        except Exception:
            logger.info("Table may be empty or still loading")

    # ================================================================
    # STEP 4b: Download CSV from current page
    # ================================================================
    async def download_country_csv(self) -> list[dict]:
        """Download the Ticketing Authority History CSV for the current country.
        Returns parsed rows as list of dicts."""

        # Click DOWNLOAD button
        download_btn = self.page.locator(SEL["download_btn"]).first
        try:
            await download_btn.wait_for(state="visible", timeout=10_000)
        except Exception:
            logger.warning("Download button not found — table may be empty")
            return []

        # Start download
        async with self.page.expect_download(timeout=TIMEOUT) as download_info:
            await download_btn.click()
            await self.page.wait_for_timeout(1000)

            # Select CSV format if popup appears
            try:
                csv_option = self.page.locator(SEL["csv_radio"]).first
                await csv_option.wait_for(state="visible", timeout=3_000)
                await csv_option.click()
                await self.page.wait_for_timeout(500)

                confirm = self.page.locator(SEL["download_confirm"]).first
                await confirm.click()
            except Exception:
                logger.info("No format selection popup — download started directly")

        download = await download_info.value
        file_path = os.path.join(self.download_dir, download.suggested_filename)
        await download.save_as(file_path)
        logger.info(f"Downloaded: {file_path}")

        # Extract CSV from ZIP if needed
        rows = self._parse_download(file_path)
        return rows

    def _parse_download(self, file_path: str) -> list[dict]:
        """Parse downloaded file (ZIP containing CSV, or direct CSV)."""
        rows = []

        if file_path.endswith(".zip"):
            with zipfile.ZipFile(file_path, "r") as zf:
                csv_files = [f for f in zf.namelist() if f.endswith(".csv")]
                if not csv_files:
                    logger.warning(f"No CSV in ZIP: {file_path}")
                    return []
                with zf.open(csv_files[0]) as f:
                    text = f.read().decode("utf-8", errors="replace")
                    rows = list(csv.DictReader(io.StringIO(text)))
        elif file_path.endswith(".csv"):
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                rows = list(csv.DictReader(f))
        else:
            # Try as CSV anyway
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                rows = list(csv.DictReader(f))

        logger.info(f"Parsed {len(rows)} rows from {file_path}")
        return rows

    # ================================================================
    # STEP 4d: Switch to another country
    # ================================================================
    async def switch_country(self, country: dict):
        """Switch BSPLink to a different country."""

        # Click globe icon
        globe = self.page.locator(SEL["globe_icon"])
        await globe.wait_for(state="visible", timeout=TIMEOUT)
        await globe.click()
        await self.page.wait_for_timeout(2000)

        # Click country dropdown
        dropdown = self.page.locator(SEL["country_dropdown"])
        await dropdown.wait_for(state="visible", timeout=TIMEOUT)
        await dropdown.click()
        await self.page.wait_for_timeout(1000)

        # Type country name to filter
        country_name = country["name"]
        await self.page.keyboard.type(country_name.split(" - ")[0][:10], delay=50)
        await self.page.wait_for_timeout(1000)

        # Click the matching option
        option = self.page.locator(f"ng-select .ng-option >> text={country_name}").first
        try:
            await option.wait_for(state="visible", timeout=5_000)
            await option.click()
        except Exception:
            # Try aria selector
            try:
                option2 = self.page.locator(f"role=option[name='{country_name}']").first
                await option2.click()
            except Exception:
                # Click first visible option
                first_opt = self.page.locator(SEL["country_options"]).first
                await first_opt.click()

        await self.page.wait_for_timeout(500)

        # Click APPLY
        apply_btn = self.page.locator(SEL["switch_apply"])
        await apply_btn.wait_for(state="visible", timeout=TIMEOUT)
        await apply_btn.click()

        # Wait for full page reload
        await self.page.wait_for_load_state("networkidle", timeout=TIMEOUT)
        await self.page.wait_for_timeout(3000)

        # Handle user selection dialog again if it appears
        await self.handle_user_selection()

        logger.info(f"Switched to country: {country_name}")

    # ================================================================
    # MAIN LOOP: Process all countries
    # ================================================================
    async def process_all_countries(self) -> dict[str, list[dict]]:
        """Process every country and return {country_code: [rows]}."""
        total = len(self.countries)
        self.results = {}

        for idx, country in enumerate(self.countries):
            if idx > 0:
                # Switch to next country
                for attempt in range(MAX_RETRIES + 1):
                    try:
                        self.progress_callback(
                            stage="switching",
                            message=f"Changement de pays: {country['name']}...",
                            percent=int(10 + (idx / total) * 85),
                            country=country["name"],
                            current=idx + 1,
                            total=total
                        )
                        await self.switch_country(country)
                        break
                    except Exception as e:
                        if attempt < MAX_RETRIES:
                            logger.warning(f"Retry switch to {country['name']}: {e}")
                            await self.page.wait_for_timeout(3000)
                        else:
                            err = f"ERREUR switch vers {country['name']}: {e}"
                            logger.error(err)
                            self.errors.append({"country": country["code"], "error": str(e)})
                            continue

            # Navigate to Ticketing Authority History
            self.progress_callback(
                stage="processing",
                message=f"Traitement: {country['name']} ({idx+1}/{total})",
                percent=int(10 + (idx / total) * 85),
                country=country["name"],
                current=idx + 1,
                total=total
            )

            rows = []
            for attempt in range(MAX_RETRIES + 1):
                try:
                    await self.navigate_to_ticketing_authority()
                    rows = await self.download_country_csv()
                    break
                except Exception as e:
                    if attempt < MAX_RETRIES:
                        logger.warning(f"Retry {country['name']}: {e}")
                        await self.page.wait_for_timeout(3000)
                    else:
                        err = f"ERREUR traitement {country['name']}: {e}"
                        logger.error(err)
                        self.errors.append({"country": country["code"], "error": str(e)})

            if not rows:
                logger.info(f"{country['code']}: EMPTY (no data)")

            self.results[country["code"]] = rows

        self.progress_callback(stage="done_scraping", message="Scraping termine!", percent=95)
        return self.results

    # ================================================================
    # FULL RUN
    # ================================================================
    async def run(self):
        """Full bot execution: connect → navigate → scrape all countries."""
        await self.connect()
        await self.navigate_to_bsplink()
        await self.handle_user_selection()
        await self.get_country_list()

        if not self.countries:
            raise RuntimeError("Aucun pays trouve. Verifiez que vous etes connecte a BSP Link.")

        await self.process_all_countries()
        return self.results
