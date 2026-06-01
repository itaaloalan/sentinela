"""Sentinela — backend FastAPI (entrypoint)."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import auth, cameras, events, notifications
from . import models as ai_models
from .database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Sentinela", version="0.1.0", lifespan=lifespan)

# Dev: frontend Vite em :5173. Ajustar/origens reais em prod.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(cameras.router)
app.include_router(ai_models.router)
app.include_router(events.router)
app.include_router(notifications.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "sentinela-backend", "version": "0.1.0"}
