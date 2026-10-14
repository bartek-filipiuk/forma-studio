# FORMA Studio

**Od pomysłu do rzeczy.** Osobisty warsztat 3D: edytor w przeglądarce, wymiary w milimetrach, elektronika referencyjna, polecenia tekstowe i eksport dokładnego CAD.

Wersja **0.1** przygotowana do dalszej pracy w Codex CLI. To uruchamialny kod aplikacji, nie sama makieta. Pierwszy projekt to **PICO — edytowalny szkic**, inspirowany wymiarami wcześniejszej instrukcji. Nie odtwarza sprawdzonej mechaniki siedmiu części z OpenSCAD. Robot w tej wersji nie ma kompletnych mocowań serw, zawiasów ani prowadzenia przewodów.

## Szybkie uruchomienie — Docker

Wymagane: Docker Engine/Desktop z Compose v2, internet do pobrania zależności, kilka GB wolnego miejsca. Docelowe środowisko referencyjne: Linux x86_64; natywne biblioteki CAD zwiększają rozmiar obrazu.

Z katalogu projektu:

```bash
test -f .env || cp .env.example .env
docker compose up --build -d
docker compose exec api python -m forma.owner
```

Open **http://localhost:8080** (this workstation uses port **18080**). The landing is public; use your owner credentials at `/login`. Readiness is `/api/ready`; `/api/health` requires a session.

Pierwsze budowanie pobiera Open CASCADE/VTK i może potrwać. Migracje bazy i utworzenie koszyka plików wykonuje jednorazowy serwis `migrate`.

```bash
docker compose logs -f api worker
docker compose down
```

`down` zachowuje wolumeny. Nie używaj `down -v`, jeśli chcesz zachować projekty i pliki.

Compose runs PostgreSQL, Redis, MinIO/S3, FastAPI, Celery and Caddy. It binds only localhost and now requires the single owner account for workshop/API access. Configure HTTPS and the public origin before any separate deployment; see [owner authentication](docs/AUTHENTICATION.md).

## Co działa

- Scena Three.js: zaznaczanie, orbitowanie, przesuwanie co 1 mm, obrót co 5°, dopasowanie kamery, prześwietlenie, widoczność części.
- Biblioteka: otwarta obudowa, głowa z oknem, pokrywa z otworami, bryła, cylinder/dystans; orientacyjne CoreS3, SG90 i PCA9685.
- Zmiana wymiarów, ścianki, promieni, otworów, położenia, obrotu i kolorów.
- „Zbuduj obudowę wokół”: powiązanie **wymiarów** z częścią referencyjną i luzem na stronę. Powiązanie nie jest więzem położenia ani pełnym solverem złożeń.
- Cofanie/ponawianie, duplikowanie, usuwanie, zapis lokalny, projekty i wersje w bazie. Konflikt zapisu między kartami zwraca 409 zamiast nadpisywać nowszy dokument.
- Polecenia lokalne oraz opcjonalny asystent OpenAI; oba tworzą te same operacje domenowe. Odpowiedź do nieaktualnej rewizji nie zostanie zastosowana.
- Dokładna przebudowa CadQuery/Open CASCADE na żądanie: walidacja bryły, rzeczywista siatka podglądu, objętość geometryczna.
- Eksport parametrycznych części do STL, STEP i standardowego **3MF bez cięcia**; proste rozłożenie na jednej płycie lub zachowanie złożenia. Referencyjna elektronika jest pomijana.
- Import STL i samodzielnego GLB jako siatek. GLB przeliczamy z metrów na mm; STL przyjmujemy w mm. Skalę trzeba zweryfikować.
- Opcjonalne obraz → 3D przez Meshy, lokalny zapis wyniku GLB, identyfikator zadania dostawcy zapisany w bazie. Bez automatycznych ponowień płatnego POST.
- Rozłożony podgląd zespołu oraz wizualny PAN/TILT grup PICO. To nie jest symulacja fizyki ani test kolizji.

## Pierwsza sesja — 5 minut

1. Otwórz PICO, wybierz **Korpus podstawy**.
2. Zmień „Ścianka” z 2,4 na 3 mm i naciśnij Enter. Cofnij `Ctrl+Z`, ponów `Ctrl+Shift+Z`.
3. Wpisz w dolnym panelu `ustaw ściankę na 3 mm`. Bez klucza działa rozpoznawanie prostych poleceń, jawnie oznaczone jako **Polecenia lokalne**.
4. Kliknij **Sprawdź i pokaż CAD**. Zostanie obliczona dokładna bryła z aktualnych parametrów.
5. Zapisz projekt. Odśwież stronę i sprawdź, czy wymiary się zachowały.
6. Kliknij **Eksportuj**, wybierz podstawę i 3MF. Ustaw prawdziwe wymiary płyty; domyślne 250 × 250 × 250 mm jest wartością roboczą, nie profilem X2D.
7. Otwórz plik w Bambu Studio. Wybierz profil drukarki, dyszę, filament, orientację i podpory. Potnij projekt i obejrzyj warstwy.

Skróty: `V` — zaznaczanie, `G` — przesuwanie, `R` — obrót, `F` — dopasuj widok, `Ctrl/⌘+S` — zapis, `Ctrl/⌘+D` — duplikuj, `Delete` — usuń. Manipulatory są wyłączone podczas podglądu pozy/rozłożenia.

## AI — konfiguracja

W `.env`:

```dotenv
FORMA_OPENAI_API_KEY=
FORMA_OPENAI_MODEL=
FORMA_MESHY_API_KEY=
FORMA_MESHY_MODEL=meshy-7.1
```

Wpisz model dostępny na swoim koncie, obsługujący Responses API i structured outputs. Nie zaszywamy identyfikatora LLM w domenie projektu. Po zmianie `.env`:

```bash
docker compose up -d --force-recreate api worker
```

Klucze nie są wysyłane do przeglądarki. Bez nich CAD, edytor, zapis i eksport nadal działają. OpenAI potrafi w tej wersji proponować dodanie/usunięcie części, zmianę parametrów i koloru; nie generuje dowolnego kodu. Pełne projektowanie z naturalnego języka wymaga rozbudowy zestawu operacji. Generowanie obrazów OpenAI nie jest jeszcze podłączone — do Meshy wgrywasz gotowy obraz.

Płatne wywołania API nie zostały wykonane podczas przygotowania paczki. Integracje należy sprawdzić ze swoimi kluczami. W przypadku przerwania generacji Meshy sprawdź `GET /api/jobs/{id}` i zapisany `provider_task_id`, zanim zlecisz kolejną płatną generację.

## Uruchomienie developerskie bez Dockera

Node 22+, Python 3.12 i `uv` 0.12.23 lub zgodny z dołączonym lockfile. Linux może potrzebować `libgl1`, `libglib2.0-0`, `libxrender1`, `libxext6`.

Terminal 1, z katalogu głównego:

```bash
cp .env.example .env
cd apps/api
uv sync --locked --extra dev
uv run uvicorn forma.main:app --host 127.0.0.1 --port 8000 --reload
```

Terminal 2, z katalogu głównego:

```bash
cd apps/web
npm ci
npm run dev
```

Frontend: http://localhost:5173. Vite przekazuje `/api` do portu 8000. Ten wariant używa SQLite, plików w `data/` i zadań w procesie API. Jest przeznaczony do szybkiej pracy lokalnej; Compose używa docelowego Postgresa, S3 i osobnego workera. **Przełączenie między tymi wariantami nie przenosi automatycznie istniejących danych.**

## Weryfikacja

```bash
cd apps/api
uv run pytest -q
```

```bash
cd apps/web
npm test
npm run build
```

Linux acceptance was completed on 2026-10-14 against the full Compose stack and Chromium: dimensions, local chat, CAD preview, save/reload, STL import and actual 3MF downloads. See `docs/VERIFICATION.md` for commands, fixes and evidence. Bambu Studio and physical printing remain unverified. On this workstation, open **http://localhost:18080**.

W `samples/exports/` znajdują się wygenerowane przez ten kod pliki: podstawa w STL/STEP i cztery części parametryczne na płycie w 3MF. Można je od razu sprawdzić w slicerze. To prototypy geometrii, bez potwierdzenia mechanicznego dopasowania.

## Przeniesienie do Codex CLI

Otwórz rozpakowany katalog w terminalu i rozpocznij sesję Codex w tym katalogu. Wklej:

> Przeczytaj AGENTS.md i docs/CODEX_HANDOFF.md. Kontynuujemy FORMA Studio. Najpierw uruchom Docker Compose i sprawdź pełny scenariusz w przeglądarce: zmiana wymiaru, polecenie tekstowe, zapis i ponowne otwarcie, import STL, eksport 3MF. Napraw znalezione problemy bez zmiany ustalonej architektury. Następnie przejdź do pierwszego zadania z handoffu.

## Struktura

| Ścieżka | Odpowiedzialność |
|---|---|
| `apps/web/src` | Interfejs React, scena, edytor parametrów, lokalna historia operacji |
| `apps/api/forma/domain.py` | Autorytatywny schemat projektu, zależności, walidacja operacji |
| `apps/api/forma/cad.py` | Generatory B-rep, triangulacja i eksport |
| `apps/api/forma/providers` | Wymienne integracje OpenAI i Meshy |
| `apps/api/forma/jobs.py` | Kolejka, izolacja natywnych obliczeń w workerze |
| `apps/api/alembic` | Wersjonowane migracje bazy |
| `packages/schema` | Katalog oraz publikowane JSON Schemas |
| `samples` | Przykładowy projekt i rzeczywiste eksporty |
| `docs` | Architektura, kontrakty, stan i przekazanie do CLI |

Dokument `.forma.json` zawiera parametry i identyfikatory plików; **nie osadza importowanych plików**. Zmiana komputera wymaga także przeniesienia bazy i zasobów albo ponownego importu. Sam przycisk JSON nie jest pełnym backupem. Kontenerowe dane są w wolumenach Postgres/MinIO; kopie obu należy wykonywać spójnie.


## Local startup overrides

If port 8080 is occupied, set `FORMA_WEB_PORT=18080` in `.env`. The service remains
bound to localhost. If the default MinIO registry image is unavailable, explicitly
set `FORMA_MINIO_IMAGE` to a trusted pinned image you can access; see the Linux
verification record for the cached digest used on this workstation. Then run
`docker compose up --build -d`.

MinIO refuses writes when free disk drops below its reserve. Free disk space
before retrying an import/export; a healthy API alone does not establish that
storage has enough capacity. Do not remove database or asset volumes to make room.

### Private owner access

The public landing is at `/`, login at `/login`, and the editor at `/app`. After
`docker compose up --build -d`, configure your sole owner account interactively:

```bash
docker compose exec api python -m forma.owner
```

There is no default password or public registration. The same command resets the
password and revokes sessions without deleting projects. See
[authentication setup and boundaries](docs/AUTHENTICATION.md) for HTTPS and tests.
