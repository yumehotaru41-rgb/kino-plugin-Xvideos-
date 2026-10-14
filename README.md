# Kino plugin: XVideos

Plugin de Kino para buscar y reproducir videos de [xvideos.com](https://www.xvideos.com).

**Contenido solo para adultos (+18).**

## Qué hace

- **search** — Búsqueda con orden, filtro de duración y opción “solo HD”
- **home** — Filas: recién subidos, mejores de la semana/mes y más vistos
- **browse** — “Ver más” de cada fila del Home
- **resolve** — Obtiene la URL del stream respetando la calidad preferida
- **download** — Permite descargar para ver sin conexión (Kino llama a `resolve`)

Todos los ítems se marcan con `adult: true`.

## Ajustes (Configurar)

| Ajuste | Opciones |
|--------|----------|
| **Calidad preferida** | Alta (HD / HLS) · Baja (ahorro de datos) · Solo HLS |
| **Orden de búsqueda** | Relevancia · Más recientes · Mejor valorados · Más vistos · Más largos |
| **Duración** | Cualquiera · 1–3 min · 3–10 min · +10 min · 10–20 min · +20 min |
| **Solo HD en búsqueda** | Interruptor |

## Instalación en Kino

1. Publica este repositorio en GitHub como **público**.
2. Añade el topic `kino-plugin` (About → Topics).
3. En Kino: **Ajustes → Plugins → Agregar** y escribe `tu-usuario/kino-plugin-xvideos`.

## Probar en local

Copia la carpeta `sdk/` desde [kinotvapp/kino-plugin-archive](https://github.com/kinotvapp/kino-plugin-archive):

```bash
node sdk/validate.mjs .
node sdk/run.mjs . search "ejemplo"
node sdk/run.mjs . resolve <id-del-video>
```

## Archivos

```
kino-plugin.json   manifiesto
plugin.js          código
icon.png           ícono (128×128)
README.md          este archivo
```

## Notas

- `"streamHosts": "any"` permite seguir redirecciones a CDNs variables.
- El parser de HTML es simple; si xvideos cambia el marcado, habrá que actualizar las regex.
- No usa el navegador oculto; todo va con `kino.fetch`.

## Licencia

Uso libre. El contenido pertenece a xvideos.com; este plugin solo actúa como cliente.
