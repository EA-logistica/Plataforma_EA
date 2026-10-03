from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # Integrado en Plataforma EA: la base es la PostgreSQL de la plataforma
    # (esquema "radar") y la carpeta de originales es radar-datos/raw. Ambas
    # las pasa el servidor Node al lanzar el worker (backend/radar/worker.js);
    # no hay .env propio que pueda apuntar a otra base y desincronizar.
    database_url: str = "postgresql+psycopg://plansa@localhost:5432/plansa?options=-csearch_path%3Dradar"
    raw_dir: Path = Path("../../../radar-datos/raw")
    scrape_delay_seconds: float = 2
    alert_price_percent: float = 20
    alert_volume_percent: float = 30
    model_config = SettingsConfigDict(extra="ignore")

settings = Settings()
