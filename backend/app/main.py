import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Setup logging: di default uvicorn imposta solo i propri logger. I logger
# delle nostre app (es. app.services.apns) restano a livello WARNING. Forza
# INFO sul root logger cosi' i log informativi (push inviati, retry, ecc)
# finiscono nei container logs.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

from app.routers import blacklist, clinical, daily_stats, day, delete as delete_router, devices, diario, health_notes, ingest, journal, lab, medical_docs, query, regimens, rules, stretching, write


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="Health Tracker Bridge API",
    description="Bridge API between Apple Health and web applications",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router)
app.include_router(query.router)
app.include_router(write.router)
app.include_router(delete_router.router)
app.include_router(blacklist.router)
app.include_router(rules.router)
app.include_router(diario.router)
app.include_router(stretching.router)
app.include_router(lab.router)
app.include_router(daily_stats.router)
app.include_router(regimens.router)
app.include_router(health_notes.router)
app.include_router(journal.router)
app.include_router(day.router)
app.include_router(devices.router)
app.include_router(clinical.router)
app.include_router(medical_docs.router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
