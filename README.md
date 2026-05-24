# NextScraper Pro 🕷️

Téléchargeur de sites web puissant avec support **Next.js**, React, et SPA.

## Stack
- **Express** + Socket.io (temps réel)
- **Axios + Cheerio** (Mode Rapide)
- **Playwright** headless (Mode Complet — Next.js/SPA)
- **Archiver** (export ZIP)

---

## Installation

### 1. Cloner & installer
```bash
npm install
```

### 2. Installer le navigateur Playwright (OBLIGATOIRE pour le Mode Complet)
```bash
npx playwright install chromium
```
> Installe ~130 MB de Chromium. Ne faire qu'une fois.

### 3. Lancer le serveur
```bash
node server.js
# ou en développement:
npx nodemon server.js
```

### 4. Ouvrir dans le navigateur
```
http://localhost:3000
```

---

## Utilisation

### Mode Rapide (Axios + Cheerio)
- ✅ Sites WordPress, statiques, SSR classique
- ✅ Rapide (pas de navigateur headless)
- ❌ Ne rend pas le JavaScript côté client

### Mode Complet (Playwright)
- ✅ **Next.js**, React, Vue, Angular, Nuxt
- ✅ Exécute le JavaScript et attend l'hydratation
- ✅ Intercepte tous les assets réseau
- ✅ Extrait `__NEXT_DATA__`, Build ID, chunks
- ✅ Détecte les appels API (`/api/*`, GraphQL)
- ⚠️ Plus lent (~2-5s par page)

---

## Options

| Option | Description |
|--------|-------------|
| **Profondeur** | Niveaux de liens à crawler (1=page seule, 5=tout le site) |
| **Délai** | Pause entre chaque requête (évite le rate-limiting) |
| **Timeout** | Temps max par page |
| **Mode Agressif** | Concurrence x5, screenshots, ignore délais partiels |

---

## Fichiers générés dans le ZIP

```
website.zip/
├── index.html              ← Pages HTML (liens réécrits en local)
├── about/index.html
├── _next/
│   └── static/             ← Chunks JS, CSS, fonts Next.js
├── images/
├── _next_data.json         ← Données __NEXT_DATA__ extraites
├── _api_calls.json         ← Appels API détectés
├── _network_log.json       ← Log réseau (Mode Complet)
├── _summary.json           ← Résumé du scraping
└── _failed_urls.txt        ← URLs échouées
```

---

## Dépannage

### "Playwright not found"
```bash
npx playwright install chromium
```

### Timeout sur sites lents
Augmentez le timeout à 60-120s dans l'interface.

### Rate-limiting (429)
Augmentez le délai à 1000-2000ms et désactivez le Mode Agressif.

### Sites derrière CloudFlare
Le Mode Complet (Playwright) contourne mieux les protections anti-bot.

---

## Variables d'environnement

```bash
PORT=3000          # Port du serveur (défaut: 3000)
```

---

by **Xhris Dior** — xhris84.netlify.app
