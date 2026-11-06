@echo off
REM ======================================================
REM Lanzador Huaca agente - modo REAL (gasta gas, sube a prod)
REM Scrapea Bluesky, filtra con LLM, genera 3 voxels,
REM MINTEA en Sepolia, SUBE la galeria a petrasynthetic.com/huaca/.
REM ======================================================
cd /d "C:\Users\petra\museo-weird-scraper"

echo.
echo ===========================================
echo   Huaca, Sistemas Magicos
echo   modo: REAL (gasta SepoliaETH)
echo   limite: 3 obras
echo   wallet: 0x1A49138cCb61C50D72A44a299F6c74c690f6c67f
echo ===========================================
echo.
echo AVISO: cada mint cuesta ~0.005 SepoliaETH.
echo        Tienes 0.0535 ETH. Suficiente para 3.
echo.
echo Cuando termine, la galeria quedara en:
echo   https://petrasynthetic.com/huaca/
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

node scripts/agent.js --once --limit=3
set RC=%errorlevel%

echo.
if %RC%==0 (
    echo ===========================================
    echo   Listo. 3 NFTs minteados y galeria subida.
    echo   Revisa: https://petrasynthetic.com/huaca/
    echo ===========================================
    echo.
    timeout /t 8
) else (
    echo [ERROR] El agente termino con codigo %RC%.
    echo Posibles causas:
    echo   - Groq rate-limit (espera 1-2h)
    echo   - Sepolia RPC caido (reintenta)
    echo   - Pinata timeout (revisar .env)
    echo.
    echo Si un mint fallo a la mitad, los demas siguen.
    echo Verifica el estado en data/art-queue.json
    echo.
    pause
)
