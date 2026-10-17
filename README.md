# Campeonato Internacional de Speedway

Sitio web del Campeonato Internacional de Speedway, organizado por el AMC Speedway (Automoto Club Bahía Blanca).

La Etapa 1 incluye el proyecto base, la base de datos (Cloudflare D1), el motor puro del reglamento, la API de administración y la API pública. La interfaz de usuario todavía no está implementada.

## Stack

- Un solo Cloudflare Worker con Static Assets: front React + TypeScript (Vite) y API con Hono.
- Base de datos Cloudflare D1 (SQLite) con migraciones SQL versionadas en `migrations/`.
- Fotos de pilotos en Cloudflare R2.
- Runtime y gestor de paquetes: Bun. Tests con `bun test`.

## Estructura

```
migrations/            Migraciones D1 (0001..0004)
scripts/seed.ts        Datos de ejemplo
src/shared/scoring/    Motor puro del reglamento (sin I/O), cubierto por tests
src/worker/            Worker: rutas, persistencia, i18n, auth, serialización
tests/                 Tests del motor y de la API (D1 con bun:sqlite + R2 mock)
web/                   Front (placeholder en Etapa 1)
```

## Puesta en marcha

Requisitos: Bun y una cuenta de Cloudflare para desplegar (no hace falta para desarrollo local).

```bash
bun install
cp .dev.vars.example .dev.vars   # ajustar ADMIN_PASSWORD y SESSION_SECRET
bun run db:migrate               # aplica migraciones en la D1 local
bun run db:seed                  # carga pilotos de ejemplo (opcional)
bun run dev                      # Vite en watch + wrangler dev
```

`.dev.vars` no se commitea. `ADMIN_PASSWORD` es la contraseña del panel y `SESSION_SECRET` la clave de firma de la sesión (HMAC).

## Scripts

| Script | Descripción |
| --- | --- |
| `bun run dev` | Desarrollo local (Vite + wrangler dev) |
| `bun run build` | Compila el front a `dist/` |
| `bun test` | Ejecuta todos los tests |
| `bun run typecheck` | Chequeo de tipos (Worker y front) |
| `bun run db:migrate` / `db:migrate:local` | Migraciones locales |
| `bun run db:migrate:remote` | Migraciones en D1 remota |
| `bun run db:seed` | Carga datos de ejemplo (agregar `--remote` para la D1 remota) |

## Reglamento implementado

El módulo `src/shared/scoring` es puro (no accede a la base ni a la red) y concentra las reglas:

- **Sorteo**: 16 titulares con número de programa (1 a 16) + 2 reservas. Genera los heats 1 a 20 con sus 4 pilotos y puertas (`HEAT_SCHEDULE`). Las series nunca se cargan a mano.
- **Puntos de heat**: 3/2/1/0; los estados `M`, `R`, `F`, `T`, `d`, `N` no suman; dead heat reparte los puntos de las posiciones involucradas.
- **Clasificación intermedia** tras el heat 20 (1.º a 18.º): los 2 primeros van a la final; LCQ1 con los 3.º, 6.º, 8.º y 9.º; LCQ2 con los 4.º, 5.º, 7.º y 10.º.
- **Final** (carrera 23): los 4 clasificados eligen puerta; el administrador las carga antes del resultado.
- **Clasificación de la fecha**: 1.º a 4.º de la final; 5.º a 10.º según los puestos en las LCQ (con desempate por la intermedia); 11.º a 18.º según la intermedia.
- **Campeonato**: 20/18/16/14/12/11/10/9/8/7/6/5/4/3/2/1/0/0 por puesto en la fecha.
- **Desempates**: si dos pilotos empatan y no hay criterio (ninguno corrió el heat compartido, o empate de 3+), y el orden cambia un resultado, el sistema marca el empate como "requiere resolución manual" y el administrador define el orden desde el panel. Sin consecuencia (17.º/18.º) se ordena por número permanente.

## API

Todas las respuestas son JSON. Las clasificaciones se calculan en el servidor al guardar un resultado y se guardan ya resueltas.

### Administración (`/api/admin`, requiere sesión)

Autenticación:

- `POST /login` `{ password }` · inicia sesión (cookie HttpOnly, 8 h; máximo 5 intentos por 15 min).
- `POST /logout`
- `GET /session`

Pilotos:

- `GET /riders` · `POST /riders` · `PUT /riders/:id` · `DELETE /riders/:id` (borra si no participó; si participó, desactiva)
- `POST /riders/:id/photo` · sube una imagen (`content-type: image/*`) a R2

Fechas:

- `GET /meetings` · `POST /meetings` · `PUT /meetings/:id` · `DELETE /meetings/:id`
- `GET /meetings/:id` · detalle con carreras, intermedia y clasificación
- `GET /meetings/:id/draw` · `PUT /meetings/:id/draw` · `POST /meetings/:id/draw/confirm` · `POST /meetings/:id/draw/redo`
- `PUT /meetings/:id/races/:raceNumber/result` · resultado de un heat, LCQ o final. Si la corrección descarta resultados ya cargados, exige `confirm: true` (si no, responde `409`).
- `PUT /meetings/:id/final/gates` · puertas elegidas por los 4 finalistas
- `POST /meetings/:id/resolve-tie` `{ riderIds: [...] }` · resuelve un empate pendiente

Traducciones:

- `GET /translations?entity=&entityId=` · `PUT /translations` `{ entity, entityId, field, lang, text }`

### Público (`/api`, solo lectura)

- `GET /championship?lang=` · posiciones del campeonato con estadísticas
- `GET /meetings?lang=` · listado de fechas
- `GET /meetings/:id?lang=` · fecha con heats, LCQ, final e intermedia
- `GET /riders?lang=` · pilotos con estadísticas
- `GET /riders/:id?lang=` · ficha del piloto con sus resultados
- `GET /photos/:key` · fotos desde R2

Idiomas: `es` (por defecto), `en`, `pl`. Números, fechas y nombres de países se formatean con `Intl`. Si falta una traducción se muestra el español.

## Despliegue

```bash
bun run build
bun run db:migrate:remote
wrangler deploy
```

Configurá los secrets en producción con `wrangler secret put ADMIN_PASSWORD` y `wrangler secret put SESSION_SECRET`. Creá la base D1 y el bucket R2 y ajustá sus identificadores en `wrangler.toml`.
