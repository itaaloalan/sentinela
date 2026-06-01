"""Resumo do dia + perguntas em linguagem natural sobre os eventos.

Trabalha em cima da tabela `Event` (o que o monitor detectou). O resumo é
determinístico (template em PT, sem LLM): contagens, por câmera/rótulo,
primeiro/último evento e horário de pico. As perguntas são respondidas por
intenção (palavras-chave) — honesto e testável; um LLM pode ser plugado depois.
"""
import datetime as dt
from collections import Counter

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from .auth import current_user
from .database import get_session
from .db_models import Camera, Event

router = APIRouter(prefix="/api/summary", tags=["summary"])


def _today() -> dt.date:
    return dt.datetime.now(dt.timezone.utc).date()


def _day_bounds(day: dt.date) -> tuple[dt.datetime, dt.datetime]:
    start = dt.datetime.combine(day, dt.time.min, tzinfo=dt.timezone.utc)
    return start, start + dt.timedelta(days=1)


def _day_events(session: Session, day: dt.date) -> list[Event]:
    start, end = _day_bounds(day)
    return list(
        session.exec(
            select(Event)
            .where(Event.created_at >= start, Event.created_at < end)
            .order_by(Event.created_at)
        ).all()
    )


def _camera_names(session: Session) -> dict[int, str]:
    return {c.id: c.name for c in session.exec(select(Camera)).all()}


def _hhmm(when: dt.datetime) -> str:
    return when.strftime("%H:%M")


def summarize(events: list[Event], names: dict[int, str], day: dt.date) -> dict:
    if not events:
        return {
            "date": day.isoformat(),
            "total": 0,
            "by_camera": [],
            "by_label": [],
            "first_at": None,
            "last_at": None,
            "busiest_hour": None,
            "text": "Nenhum evento registrado hoje.",
        }

    by_label = Counter(e.label for e in events)
    by_camera = Counter(names.get(e.camera_id, f"câmera {e.camera_id}") for e in events)
    hours = Counter(e.created_at.hour for e in events)
    busiest_hour, _ = hours.most_common(1)[0]
    first, last = events[0].created_at, events[-1].created_at

    labels_txt = ", ".join(f"{n}× {label}" for label, n in by_label.most_common())
    cams_txt = ", ".join(f"{cam} ({n})" for cam, n in by_camera.most_common())
    text = (
        f"Entre {_hhmm(first)} e {_hhmm(last)} houve {len(events)} evento(s): "
        f"{labels_txt}. Por câmera: {cams_txt}. "
        f"Horário de pico: {busiest_hour:02d}h."
    )
    return {
        "date": day.isoformat(),
        "total": len(events),
        "by_camera": [{"camera": c, "count": n} for c, n in by_camera.most_common()],
        "by_label": [{"label": label, "count": n} for label, n in by_label.most_common()],
        "first_at": first.isoformat(),
        "last_at": last.isoformat(),
        "busiest_hour": busiest_hour,
        "text": text,
    }


def answer(events: list[Event], names: dict[int, str], question: str) -> str:
    """Responde por intenção (palavras-chave) sobre os eventos do dia."""
    q = question.lower().strip()
    total = len(events)
    if total == 0:
        return "Hoje ainda não houve nenhum evento."

    # "quando / que horas" → lista os horários
    if "quando" in q or "que horas" in q or "horário" in q or "horario" in q:
        horarios = ", ".join(_hhmm(e.created_at) for e in events)
        return f"Eventos registrados às {horarios}."

    # menção a uma câmera específica
    for cam_id, name in names.items():
        if name.lower() in q:
            n = sum(1 for e in events if e.camera_id == cam_id)
            return f"A câmera '{name}' registrou {n} evento(s) hoje."

    # menção a um rótulo específico (ex.: aberto)
    for label in {e.label for e in events}:
        if label.lower() in q:
            n = sum(1 for e in events if e.label == label)
            return f"Houve {n} evento(s) de '{label}' hoje."

    # "quantos / quantas" ou fallback
    return f"Hoje houve {total} evento(s) no total."


class AskIn(BaseModel):
    question: str


@router.get("/today")
def today(
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    day = _today()
    return summarize(_day_events(session, day), _camera_names(session), day)


@router.post("/ask")
def ask(
    body: AskIn,
    _: str = Depends(current_user),
    session: Session = Depends(get_session),
):
    day = _today()
    events = _day_events(session, day)
    return {"question": body.question, "answer": answer(events, _camera_names(session), body.question)}
