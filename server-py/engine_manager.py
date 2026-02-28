"""Registry of engine adapters."""

from __future__ import annotations

from adapters.base import EngineAdapter
from models import EngineInfo


class EngineManager:
    def __init__(self) -> None:
        self._adapters: dict[str, EngineAdapter] = {}

    def register(self, adapter: EngineAdapter) -> None:
        if adapter.id in self._adapters:
            raise ValueError(f'Adapter "{adapter.id}" is already registered')
        self._adapters[adapter.id] = adapter

    def get(self, engine_id: str) -> EngineAdapter:
        adapter = self._adapters.get(engine_id)
        if adapter is None:
            raise ValueError(f'Unknown engine "{engine_id}"')
        return adapter

    def list(self) -> list[EngineInfo]:
        return [
            EngineInfo(
                id=a.id,
                name=a.name,
                type=a.engine_type,
                connected=a.is_connected(),
            )
            for a in self._adapters.values()
        ]
