"""Abstract base class for planning engine adapters."""

from __future__ import annotations

from abc import ABC, abstractmethod

from models import (
    CellWrite,
    CellWriteResult,
    DimensionItem,
    ModuleDataRequest,
    ModuleDataResponse,
    ParentFilter,
    WorkspaceInfo,
    WorkspaceSchema,
)


class EngineAdapter(ABC):
    """Every planning engine must implement this interface."""

    @property
    @abstractmethod
    def id(self) -> str: ...

    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def engine_type(self) -> str: ...

    @abstractmethod
    async def connect(self, config: dict[str, str] | None = None) -> None: ...

    @abstractmethod
    async def disconnect(self) -> None: ...

    @abstractmethod
    def is_connected(self) -> bool: ...

    @abstractmethod
    async def get_workspaces(self) -> list[WorkspaceInfo]: ...

    @abstractmethod
    async def get_schema(self, workspace_id: str) -> WorkspaceSchema: ...

    @abstractmethod
    async def get_dimension_items(
        self,
        workspace_id: str,
        dimension_id: str,
        parent_filter: ParentFilter | None = None,
    ) -> list[DimensionItem]: ...

    @abstractmethod
    async def get_line_item_values(
        self,
        workspace_id: str,
        module_id: str,
        line_item_id: str,
        version: str,
    ) -> list[str]: ...

    @abstractmethod
    async def get_module_data(
        self,
        workspace_id: str,
        module_id: str,
        request: ModuleDataRequest,
    ) -> ModuleDataResponse: ...

    @abstractmethod
    async def write_cells(
        self,
        workspace_id: str,
        module_id: str,
        version: str,
        cells: list[CellWrite],
    ) -> CellWriteResult: ...
