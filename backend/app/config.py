"""Configuração via variáveis de ambiente (.env). Ver .env.example."""
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", case_sensitive=False
    )

    # Auth (mapeia SENTINELA_* do .env.example)
    secret_key: str = Field("dev-insecure-change-me", validation_alias="SENTINELA_SECRET_KEY")
    admin_user: str = Field("admin", validation_alias="SENTINELA_ADMIN_USER")
    admin_pass: str = Field("changeme", validation_alias="SENTINELA_ADMIN_PASS")
    jwt_ttl_minutes: int = 60 * 12

    # Persistência
    database_url: str = Field(
        "sqlite:///./data/sentinela.db", validation_alias="DATABASE_URL"
    )

    # Streaming
    go2rtc_url: str = Field("http://localhost:1984", validation_alias="GO2RTC_URL")
    onvif_port: int = Field(5000, validation_alias="ONVIF_PORT")  # PTZ (Yoosee=5000)

    # Notificação (ntfy)
    ntfy_server: str = Field("https://ntfy.sh", validation_alias="NTFY_SERVER")
    ntfy_topic: str = Field("sentinela-troque-isto", validation_alias="NTFY_TOPIC")
    discord_webhook: str = Field("", validation_alias="DISCORD_WEBHOOK")
    app_public_url: str = Field("http://localhost:5173", validation_alias="APP_PUBLIC_URL")

    # IA
    ai_data_dir: str = Field("../ai/data", validation_alias="AI_DATA_DIR")
    ai_frame_interval_seconds: int = Field(5, validation_alias="AI_FRAME_INTERVAL_SECONDS")
    ai_open_debounce_seconds: int = Field(45, validation_alias="AI_OPEN_DEBOUNCE_SECONDS")
    ai_confidence_threshold: float = Field(0.8, validation_alias="AI_CONFIDENCE_THRESHOLD")
    # Zero-shot por descrições (CLIP multilíngue — entende PT). ~1,1GB no 1º uso.
    clip_model: str = Field("xlm-roberta-base-ViT-B-32", validation_alias="CLIP_MODEL")
    clip_pretrained: str = Field("laion5b_s13b_b90k", validation_alias="CLIP_PRETRAINED")


settings = Settings()
