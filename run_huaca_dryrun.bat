@echo off
REM ======================================================
REM Lanzador Huaca agente - modo SEGURO (dry-run, no gasta gas)
REM Scrapea Bluesky, filtra con LLM, genera 3 voxels HTML.
REM NO firma transacciones. NO sube a produccion.
REM ======================================================
cd /d "C:\Users\petra\museo-weird-scraper"

echo.
echo ===========================================
echo   Huaca, Sistemas Magicos
echo   modo: dry-run (no gas, no prod)
echo   limite: 3 obras
echo ===========================================
echo.
echo Cuando termine, veras los voxels en:
echo   C:\Users\petra\museo-weird-scraper\data\artworks\
echo.
echo Cierra esta ventana para abortar.
echo.

REM Verificar Node
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js no esta en PATH. Instala desde https://nodejs.org
    pause
    exit /b 1
)

REM Verificar .env
if not exist ".env" (
    echo [ERROR] No existe .env en la raiz del proyecto.
    pause
    exit /b 1
)

node scripts/agent.js --once --dry-run --limit=3
set RC=%errorlevel%

echo.
if %RC%==0 (
    echo ===========================================
    echo   Dry-run OK. Si te gusto el resultado,
    echo   corre  run_huaca.bat  para ir a produccion.
    echo ===========================================
    echo.
    timeout /t 8
) else (
    echo [ERROR] El agente termino con codigo %RC%.
    echo Revisa los logs arriba. Si fue Groq, espera 1-2h.
    echo.
    pause
)
