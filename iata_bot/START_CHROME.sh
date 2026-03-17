#!/bin/bash
# =============================================================
# APG Assistant — Lancer Chrome en mode debug
# =============================================================
# Ce script ferme Chrome puis le relance avec le port de debug
# activé pour que le bot puisse se connecter au navigateur.
# =============================================================

echo "Fermeture de Chrome..."
pkill -a -i "Google Chrome" 2>/dev/null
sleep 2

echo "Lancement de Chrome en mode debug (port 9222)..."
open -a "Google Chrome" --args --remote-debugging-port=9222

echo ""
echo "Chrome est pret !"
echo "Connectez-vous sur https://portal.iata.org puis lancez le bot."
echo ""
