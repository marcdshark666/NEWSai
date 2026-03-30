# NEWSai

NEWSai ar en statisk videovagg for nyhetskallor som uppdateras automatiskt fran konfigurerade sajter.

Den har forsta versionen ar byggd for:

- GitHub Pages som webbhotell
- GitHub Actions for uppdatering var 20:e minut
- en Netflix-inspirerad layout med banderoller och karuseller
- videofokuserade rader for TV4, SVT Play, Fox News och BBC

## Forsta kallor

Projektet ar forberett med:

- `TV4 Nyheterna`
- `TV4 Ekonomi`
- `SVT Play` med `Rapport`, `Aktuellt`, `Sportnytt`, `Morgonstudion` och `Kulturnyheterna`
- `Fox News Video`
- `BBC Video`

Notering: vissa kallor tillater inte alltid full iframe-uppspelning pa tredjepartssidor. Sidan har darfor alltid en fallback-lank till originalkallan om en spelare blockeras.

## Struktur

- `docs/index.html` - webbplatsen
- `docs/styles.css` - designen
- `docs/app.js` - frontendlogiken
- `docs/data/news.json` - cachad nyhetsdata
- `config/sources.json` - kallor
- `scripts/update_video_feed.py` - videohamtning och cachebyggning
- `.github/workflows/update-news.yml` - schemalagd uppdatering
- `.github/workflows/deploy-pages.yml` - publicering till GitHub Pages

## Publicering

1. Pusha repo:t till GitHub.
2. Aktivera GitHub Pages med GitHub Actions som source.
3. Kor `Update News Cache` manuellt for att fylla forsta videodatan direkt.

Nar du skickar fler lankar bygger jag ut fler kallstrategier och fler sektioner i layouten.
