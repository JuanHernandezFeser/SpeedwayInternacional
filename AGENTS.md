# Campeonato Internacional de Speedway — contexto del proyecto

## Qué es
Sitio web del "Campeonato Internacional de Speedway" (verano argentino), organizado por el AMC Speedway – Automoto Club Bahía Blanca. Solo se maneja la edición actual (sin histórico de temporadas por ahora).

Sitio público:
1. Posiciones del campeonato.
2. Fechas y sus resultados (heats, LCQ, final y clasificación de la fecha).
3. Pilotos, con resultados y estadísticas.

Panel de administración: un único usuario, solo en español, usable desde celular. Todos los datos se cargan en español.

## Stack y hosting (todo en Cloudflare)
- Un solo Worker con Static Assets: front React + TypeScript (Vite) y API con Hono.
- Base de datos: Cloudflare D1 (SQLite), con migraciones SQL versionadas.
- Fotos de pilotos: Cloudflare R2.
- Runtime y gestor de paquetes: Bun. Tests: bun test.
- Las clasificaciones se calculan en el servidor al guardar un resultado y se guardan ya resueltas en D1; el sitio público solo lee.

## Idiomas
- Sitio público en español, inglés y polaco (rutas /es, /en, /pl).
- Panel de administración solo en español.
- El administrador carga todo el contenido de texto solo en español; las versiones en inglés y polaco se generan automáticamente (etapa 4) y se guardan por idioma en D1. Se aceptan tal cual, sin revisión manual por ahora. Si falta una traducción, se muestra el español.
- Todo contenido cargado desde el panel y mostrado al público debe poder traducirse.
- Números, puntos, fechas y nombres de países no se almacenan traducidos: se formatean por idioma con Intl.

## Diseño (identidad del AMC Speedway)
Tema oscuro; azul intenso como base, amarillo vibrante como acento, blanco y celeste secundarios. Titulares en tipografía condensada, en mayúsculas e inclinada; texto de tablas en tipografía neutra y legible. Detalles gráficos (diagonales, bandera a cuadros, estrellas) con moderación. Fichas de pilotos con número, bandera y foto. Debe verse bien en celular, tablet y escritorio; las tablas anchas hacen scroll horizontal dentro de su contenedor.

## Reglamento (formato SGP, sin carrera sprint)
Cada fecha: 16 pilotos titulares + 2 reservas. Carreras numeradas 1 a 23, todas de 4 pilotos:
- Heats 1 a 20 (fase principal). Cada piloto corre 5 heats.
- LCQ1 (carrera 21), LCQ2 (carrera 22) y final (carrera 23).

### Número de programa y sorteo
Cada piloto tiene un número permanente (por ejemplo 757). En cada fecha, el administrador carga el resultado del sorteo: a cada uno de los 16 titulares se le asigna un número de programa del 1 al 16 (sin repetir) y se indican los 2 reservas. Ese número determina en qué heats corre y desde qué puerta. Las series NUNCA se cargan a mano: se generan solas a partir del sorteo.

### Posiciones de largada de los heats 1 a 20
Números de programa, en orden de puerta 1, 2, 3, 4:
H1: 1 2 3 4 | H2: 5 7 6 8 | H3: 10 11 9 12 | H4: 15 14 16 13
H5: 13 1 5 9 | H6: 14 10 2 6 | H7: 11 15 7 3 | H8: 4 8 12 16
H9: 6 16 1 11 | H10: 12 5 15 2 | H11: 8 9 3 14 | H12: 13 4 10 7
H13: 7 12 14 1 | H14: 2 13 8 11 | H15: 16 3 10 5 | H16: 9 6 4 15
H17: 1 8 15 10 | H18: 9 2 7 16 | H19: 3 12 13 6 | H20: 5 14 11 4
Cada par de pilotos comparte exactamente un heat.

### Generación automática de carreras
- Al confirmar el sorteo se crean los heats 1 a 20 con sus 4 pilotos y puertas según la tabla. Ejemplo de control: quien sortee el número 5 corre el heat 2 (puerta 1), el 5 (puerta 3), el 10 (puerta 2), el 15 (puerta 4) y el 20 (puerta 1).
- Al cargar los 20 heats se calcula la clasificación intermedia y se crean las carreras 21 y 22 (LCQ) con los pilotos que corresponden y sus puertas ya asignadas. El administrador solo carga los resultados.
- Al cargar las dos LCQ se crea la carrera 23 (final) con los 4 clasificados pero SIN puertas. El administrador carga las puertas elegidas por los pilotos (4 puertas distintas, 1 a 4) antes de poder cargar el resultado.
- Si hay un empate de la intermedia que requiere resolución manual, las carreras que dependen de él se crean recién cuando el administrador lo resuelve.
- El sorteo no puede modificarse si la fecha ya tiene resultados cargados. Para rehacerlo hay que confirmar explícitamente el borrado de los resultados de esa fecha.

### Puntos de heat (heats 1 a 20)
1.º 3 pts, 2.º 2 pts, 3.º 1 pt, 4.º 0 pt. Los pilotos con estado M, R, F, T, d o N no suman. En caso de dead heat, los puntos de las posiciones involucradas se reparten en partes iguales (puede haber medios puntos).

### Clasificación intermedia (tras el heat 20)
Del 1.º al 18.º según los puntos de heat acumulados.
- Los 2 primeros van directo a la final.
- LCQ1 (carrera 21): intermedios 3.º, 6.º, 8.º y 9.º, largando de la puerta 1 a la 4 en ese orden (el 3.º en la puerta 1, el 6.º en la 2, el 8.º en la 3, el 9.º en la 4).
- LCQ2 (carrera 22): intermedios 4.º, 5.º, 7.º y 10.º, largando de la puerta 1 a la 4 en ese orden.
- Los ganadores de LCQ1 y LCQ2 pasan a la final.
- Final (carrera 23): los pilotos eligen puerta y el administrador la carga. El panel muestra el orden de elección: primero los 2 mejores de la intermedia (por posición) y luego los ganadores de LCQ1 y LCQ2 (ordenados por su posición en la intermedia).

### Clasificación de la fecha
- 1.º a 4.º: según el resultado de la final.
- 5.º y 6.º: los segundos de LCQ1 y LCQ2. El mejor ubicado en la intermedia es 5.º y el otro 6.º. Si solo uno no completó la carrera, ese queda 6.º.
- 7.º y 8.º: los terceros de LCQ. Misma regla (si solo uno no completó, queda 8.º).
- 9.º y 10.º: los cuartos de LCQ. Misma regla (si solo uno no completó, queda 10.º).
- 11.º a 18.º: según la clasificación intermedia.

### Puntos del campeonato según el puesto en la fecha
1.º 20, 2.º 18, 3.º 16, 4.º 14, 5.º 12, 6.º 11, 7.º 10, 8.º 9, 9.º 8, 10.º 7, 11.º 6, 12.º 5, 13.º 4, 14.º 3, 15.º 2, 16.º 1, 17.º 0, 18.º 0.
La tabla del campeonato suma los puntos de todas las fechas.

### Pilotos que no pueden correr una carrera ya clasificada (LCQ/final)
Las posiciones se definen por el orden de llegada y, para el resto, por el orden en que fueron descalificados o se retiraron; si no alcanza, rige la clasificación intermedia. Estas decisiones las toma el árbitro, por lo que el panel debe permitir corregir a mano posiciones y estados.

### Reservas
Un reserva puede reemplazar a un titular en un heat concreto: ocupa la misma puerta y los puntos de ese heat los suma el reserva para sí mismo, no el titular reemplazado. Los reservas participan de la clasificación de la fecha (18 puestos).

### Desempate en la clasificación intermedia
Si dos pilotos empatan en puntos de heat, gana el que obtuvo mejor resultado en el heat que compartieron (según la tabla de largadas). Si uno de los dos no corrió ese heat (fue reemplazado), gana el que sí lo corrió.
Casos SIN criterio definido: (a) ninguno de los dos corrió el heat compartido; (b) empate entre 3 o más pilotos. En esos casos el sistema NO decide: marca el empate como "requiere resolución manual" y el administrador define el orden desde el panel. Lo mismo para empates en la tabla del campeonato: no hay criterio definido todavía, se muestran como empatados.

## Estadísticas por piloto (calculadas, no se cargan)
Puntos totales del campeonato, fechas disputadas, mejor resultado en una fecha, heats corridos, victorias de heat, promedio de puntos por heat y apariciones en la final.

## Convenciones de trabajo
- Código y nombres técnicos en inglés; textos de interfaz y mensajes de usuario vía archivos de traducción.
- La lógica del reglamento vive en un módulo puro de TypeScript (sin acceso a la base de datos ni a la red), cubierto por pruebas.
- Antes de cambios grandes, proponer un plan y esperar confirmación.
