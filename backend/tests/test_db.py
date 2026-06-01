from app import db


def test_next_id_increments():
    a = db.next_id()
    b = db.next_id()
    assert b == a + 1


def test_in_memory_stores_exist():
    assert isinstance(db.ai_models, dict)
    assert isinstance(db.events, list)
