from app.config import Settings, settings


def test_settings_singleton_has_expected_values():
    assert settings.admin_user == "admin"
    assert settings.admin_pass == "secret"
    assert settings.database_url.startswith("sqlite:///")
    assert settings.go2rtc_url.startswith("http")


def test_settings_defaults_without_env(monkeypatch):
    for var in ("DATABASE_URL", "GO2RTC_URL", "SENTINELA_ADMIN_USER"):
        monkeypatch.delenv(var, raising=False)
    fresh = Settings(_env_file=None)
    assert fresh.database_url == "sqlite:///./data/sentinela.db"
    assert fresh.admin_user == "admin"
    assert fresh.jwt_ttl_minutes == 60 * 12
