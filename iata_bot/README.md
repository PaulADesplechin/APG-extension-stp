# APG Assistant — BSPLink Bot

Verification automatique des statuts Enable/Disable pour tous les pays sur BSP Link.

---

## Utilisation (3 etapes)

### 1. Lancer Chrome en mode debug

Double-cliquez sur `START_CHROME.sh` (ou ouvrez un Terminal et tapez) :

```bash
./START_CHROME.sh
```

Chrome s'ouvre. **Connectez-vous sur https://portal.iata.org** avec vos identifiants habituels + 2FA.

### 2. Lancer le bot

Ouvrez un **deuxieme Terminal** et tapez :

```bash
./run.sh
```

L'interface s'ouvre automatiquement dans votre navigateur (http://localhost:5050).

### 3. Utiliser l'interface

1. **Uploadez** votre fichier eBulletin CSV (glisser-deposer ou cliquer)
2. Cliquez **"Lancer le Bot"**
3. **Attendez** — le bot traite chaque pays automatiquement (~30-45 min pour 130 pays)
4. **Telechargez** le fichier Excel quand c'est termine

---

## Ce que fait le bot

Pour chaque pays (~130) :

1. Ouvre BSP Link depuis le portail IATA
2. Selectionne le pays
3. Va dans **Master Data → Ticketing Authority History**
4. Telecharge le tableau des Agent Codes
5. Compare avec votre fichier eBulletin :
   - `TERMINATIONS` → l'agent doit etre **Disabled** dans BSPLink
   - `REINSTATEMENTS` → l'agent doit etre **Enabled** dans BSPLink
   - `NEW APPLICATIONS` → nouvel agent (pas encore dans BSPLink)
   - `IRREGULARITIES` → a verifier manuellement
6. Passe au pays suivant

### Fichier Excel final

Le rapport contient :
- **SUMMARY** : toutes les anomalies (MISMATCH) de tous les pays
- **STATS** : tableau recapitulatif par pays
- **1 onglet par pays** : detail complet avec la colonne Discrepancy

---

## En cas de probleme

- **"Impossible de se connecter a Chrome"** → Relancez `START_CHROME.sh` et reconnectez-vous au portail
- **Le bot plante sur un pays** → Il passe automatiquement au suivant. Les erreurs sont affichees a la fin
- **Fichier errors.log** → Contient le detail de toutes les erreurs

---

## Installation (premiere fois uniquement)

Prerequis : Python 3.10+ installe sur votre Mac.

```bash
# Le script run.sh fait tout automatiquement, mais si besoin :
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```
