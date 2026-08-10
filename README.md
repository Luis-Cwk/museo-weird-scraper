# MUSEO WEIRD

Bot autónomo que rastrea Bluesky en busca de contenido extraño, ilegal, surrealista y controvertido sobre museos y artefactos mexicanos (y violencia de género en espacios culturales), para luego transformarlo en arte tipográfico NFT.

Cada pieza comienza siendo algo real: un artefacto robado, un objeto maldito, una exhibición censurada, un museo en decadencia. El bot lo encuentra, lo encuadra y lo convierte en arte.

## ¿Qué es esto?

Un agente de IA autónomo que funciona las 24 horas del día, los 7 días de la semana, sin intervención humana:

1. Rastrear Bluesky (AT Protocol) en busca de contenido sobre museos, artefactos y patrimonio cultural mexicano — más de 30 consultas de búsqueda configurables vía `BLUESKY_SEARCH_TERMS`.
2. Filtrar solo contenido en español con heurística ligera (`isLikelySpanish`).
3. Clasificar el contenido usando Llama 3.1 70B vía NVIDIA NIM (solo contenido genuinamente extraño/ilegal/surrealista o relacionado con violencia de género en espacios culturales).
4. Procesar todo a través de un guardia de seguridad de 2 niveles.
5. Generar obras de arte tipográficas a partir del contenido.
6. Poner en cola para la acuñación (minting) como NFT.

## Arquitectura

```
Bluesky AT Protocol (search.posts sobre 30+ queries en español)
    |
    v
Filtro ligero de idioma + limpieza de embeds
    |
    v
Bot de extracción — Llama 3.1 70B (NVIDIA NIM) extrae + califica
    |
    v
+-- GUARDIA DE SEGURIDAD (dos niveles) -------------------+
|                                                         |
|  Nivel 1: Sanitizador de contenido (regex)              |
|    - URLs, correos, teléfonos, wallets, PII             |
|    - HTML, código, inyección, caracteres de control     |
|    - Handles sociales, nombres ENS                      |
|                                                         |
|  Nivel 2: Verificador de IA (llamada separada a Llama)  |
|    - Verificación de relevancia (México + museos/artef.)|
|    - Verificación del enfoque extraño/oscuro/surrealista|
|    - Detección de ataques de inyección                  |
|    - Filtro de calidad autónomo                         |
+---------------------------------------------------------+
    |
    v
Generador de plantillas SVG — obra de arte tipográfica
    |
    v
Cola de arte — lista para acuñar
```

## Categorías de contenido

| Categoría | Descripción |
| --- | --- |
| theft | Artefactos robados, sitios saqueados |
| trafficking | Comercio ilegal de patrimonio cultural |
| censorship | Exhibiciones controvertidas, arte prohibido |
| surreal | Datos extraños, inquietantes o desconcertantes |
| ritual | Objetos rituales, artículos malditos |
| corruption | Escándalos en instituciones culturales |
| abandonment | Museos olvidados o en decadencia |
| narco | Intersecciones entre narco y arte |
| colonial | Saqueo colonial, repatriación |
| remains | Restos humanos, momias en colecciones |
| black_market | Comercio clandestino de artefactos |
| gender_violence | Violencia de género en espacios culturales / arte feminista |

## Cómo ejecutar

### Prerrequisitos

* Node.js 18+
* Una cuenta de Bluesky (gratis en bsky.social) + un App Password
* Una clave de API de NVIDIA (gratis con créditos iniciales en build.nvidia.com)

### Configuración

```bash
npm install
cp .env.example .env
# Rellena tus valores en .env

```

Variables requeridas:
- `BLUESKY_HANDLE` — tu handle de Bluesky (ej: `usuario.bsky.social`)
- `BLUESKY_APP_PASSWORD` — generado en Settings → Privacy → App Passwords
- `NVIDIA_API_KEY` — desde https://build.nvidia.com/

### Ejecutar el agente

```bash
# Agente autónomo completo (se ejecuta cada 12 horas)
npm run agent

# Ejecución de prueba (dry run) — flujo completo, sin acuñar
npm run agent:dry

# Ciclo único y luego salir
npm run agent:once
```

### Ejecutar pasos individuales

```bash
npm run scrape:test-bsky       # Verifica conexión con Bluesky
npm run scrape:test-llm        # Verifica conexión con NVIDIA NIM
npm run scrape                 # Scrape completo
npm run scrape:stats           # Revisar candidatos rastreados
npm run scrape:approve         # Aprobar candidatos a la cola de arte
npm run guard:test             # Ejecutar pruebas del sanitizador
npm run guard:test:full        # Ejecutar pruebas del sanitizador + verificador de IA
```

## Tech Stack

| Componente | Tecnología |
| --- | --- |
| Fuente de datos | Bluesky AT Protocol (search.posts) |
| Clasificación de IA | Llama 3.1 70B vía NVIDIA NIM |
| Seguridad de IA | Llama 3.1 70B (llamada de verificación separada) |
| Entorno de ejecución | TypeScript, ts-node |
| Arte | Plantillas SVG |

## Costo de operación

| Elemento | Costo |
| --- | --- |
| API de Bluesky | Gratis |
| NVIDIA NIM (Llama 3.1 70B) | Gratis hasta agotar créditos de prueba (~5000 tokens iniciales) |
| **Total** | **$0/mes** dentro del free tier |

## Licencia

MIT