# Vikingos Shop · Inventario

Aplicación web instalable para llevar el inventario de Vikingos Shop. Funciona en el teléfono, incluso sin internet, y sincroniza los datos con una planilla de Google Sheets (las fotos van a Google Drive) mediante un script de Google Apps Script.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura de todas las pantallas y ventanas. |
| `estilos.css` | Colores, tipografías y diseño. Los colores están al inicio, en `:root`. |
| `datos.js` | Datos guardados en el teléfono, cola de cambios pendientes y sincronización con Google. |
| `ui.js` | Pantallas, botones y formularios. |
| `sw.js` | Permite abrir la aplicación sin internet. **Suba el número de `VERSION` cada vez que cambie un archivo.** |
| `manifest.webmanifest` | Nombre e íconos al instalarla en el teléfono. |
| `fonts/`, `img/` | Tipografías (Pacifico y Poppins) y el logo en varios tamaños. |

El enlace del servidor **no está en este código** a propósito. Cada teléfono lo recibe una sola vez abriendo el enlace de configuración (termina en `#s=…`) y lo guarda en el propio aparato.

## Publicar en GitHub Pages

1. Cree un repositorio en GitHub y suba **el contenido** de esta carpeta (no el .zip).
2. En el repositorio: Settings → Pages → «Deploy from a branch» → rama `main`, carpeta `/ (root)`.
3. Al cabo de un minuto la página queda en `https://SU-USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/`.
