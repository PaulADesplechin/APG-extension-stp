#!/bin/bash
# =============================================================
# APG Assistant — Lancement du bot
# =============================================================

cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "venv" ]; then
    echo "Installation de l'environnement..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    playwright install chromium
else
    source venv/bin/activate
fi

echo ""
echo "==================================="
echo "  APG Assistant - BSPLink Bot"
echo "==================================="
echo ""
echo "L'interface s'ouvre dans votre navigateur..."
echo ""

python3 app/main.py
