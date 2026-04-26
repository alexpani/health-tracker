from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import blacklist, daily_stats, delete as delete_router, diario, ingest, lab, query, rules, stretching, write


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


@app.get("/health")
async def health_check():
    return {"status": "ok"}
