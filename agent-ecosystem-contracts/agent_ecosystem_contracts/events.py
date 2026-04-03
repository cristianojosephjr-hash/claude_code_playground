from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping


class Provider(str, Enum):
    CLAUDE = "claude"
    CODEX = "codex"
    GEMINI = "gemini"
    OPENCODE = "opencode"
    DROID = "droid"
    COPILOT = "copilot"
    CODEBUDDY = "codebuddy"
    QWEN = "qwen"
    UNKNOWN = "unknown"

    @classmethod
    def from_value(cls, value: str | None) -> "Provider":
        if not value:
            return cls.UNKNOWN
        normalized = value.strip().lower()
        for member in cls:
            if member.value == normalized:
                return member
        return cls.UNKNOWN


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    TOOL = "tool"
    UNKNOWN = "unknown"

    @classmethod
    def from_value(cls, value: str | None) -> "MessageRole":
        if not value:
            return cls.UNKNOWN
        normalized = value.strip().lower()
        for member in cls:
            if member.value == normalized:
                return member
        return cls.UNKNOWN


class SessionStatus(str, Enum):
    ACTIVE = "active"
    IDLE = "idle"
    CLOSED = "closed"
    FAILED = "failed"
    UNKNOWN = "unknown"

    @classmethod
    def from_value(cls, value: str | None) -> "SessionStatus":
        if not value:
            return cls.UNKNOWN
        normalized = value.strip().lower()
        for member in cls:
            if member.value == normalized:
                return member
        return cls.UNKNOWN


class TaskStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    DONE = "done"
    FAILED = "failed"
    UNKNOWN = "unknown"

    @classmethod
    def from_value(cls, value: str | None) -> "TaskStatus":
        if not value:
            return cls.UNKNOWN
        normalized = value.strip().lower()
        for member in cls:
            if member.value == normalized:
                return member
        return cls.UNKNOWN


@dataclass(frozen=True)
class Message:
    id: str
    session_id: str
    role: MessageRole
    content: str
    timestamp: str
    provider: Provider = Provider.UNKNOWN
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "role": self.role.value,
            "content": self.content,
            "timestamp": self.timestamp,
            "provider": self.provider.value,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "Message":
        return cls(
            id=str(value.get("id", "")),
            session_id=str(value.get("session_id", "")),
            role=MessageRole.from_value(str(value.get("role", ""))),
            content=str(value.get("content", "")),
            timestamp=str(value.get("timestamp", "")),
            provider=Provider.from_value(str(value.get("provider", ""))),
            metadata=dict(value.get("metadata", {}) or {}),
        )


@dataclass(frozen=True)
class ToolCall:
    id: str
    session_id: str
    provider: Provider
    tool_name: str
    arguments: Mapping[str, Any]
    caller: str
    timestamp: str
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "provider": self.provider.value,
            "tool_name": self.tool_name,
            "arguments": dict(self.arguments),
            "caller": self.caller,
            "timestamp": self.timestamp,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "ToolCall":
        return cls(
            id=str(value.get("id", "")),
            session_id=str(value.get("session_id", "")),
            provider=Provider.from_value(str(value.get("provider", ""))),
            tool_name=str(value.get("tool_name", "")),
            arguments=dict(value.get("arguments", {}) or {}),
            caller=str(value.get("caller", "")),
            timestamp=str(value.get("timestamp", "")),
            metadata=dict(value.get("metadata", {}) or {}),
        )


@dataclass(frozen=True)
class ToolResult:
    id: str
    tool_call_id: str
    session_id: str
    provider: Provider
    success: bool
    output: Any
    error: str | None
    timestamp: str
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tool_call_id": self.tool_call_id,
            "session_id": self.session_id,
            "provider": self.provider.value,
            "success": self.success,
            "output": self.output,
            "error": self.error,
            "timestamp": self.timestamp,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "ToolResult":
        return cls(
            id=str(value.get("id", "")),
            tool_call_id=str(value.get("tool_call_id", "")),
            session_id=str(value.get("session_id", "")),
            provider=Provider.from_value(str(value.get("provider", ""))),
            success=bool(value.get("success", False)),
            output=value.get("output"),
            error=str(value["error"]) if value.get("error") is not None else None,
            timestamp=str(value.get("timestamp", "")),
            metadata=dict(value.get("metadata", {}) or {}),
        )


@dataclass(frozen=True)
class Session:
    id: str
    provider: Provider
    work_dir: str
    status: SessionStatus
    started_at: str
    updated_at: str
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "provider": self.provider.value,
            "work_dir": self.work_dir,
            "status": self.status.value,
            "started_at": self.started_at,
            "updated_at": self.updated_at,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "Session":
        return cls(
            id=str(value.get("id", "")),
            provider=Provider.from_value(str(value.get("provider", ""))),
            work_dir=str(value.get("work_dir", "")),
            status=SessionStatus.from_value(str(value.get("status", ""))),
            started_at=str(value.get("started_at", "")),
            updated_at=str(value.get("updated_at", "")),
            metadata=dict(value.get("metadata", {}) or {}),
        )


@dataclass(frozen=True)
class Task:
    id: str
    title: str
    status: TaskStatus
    session_id: str | None = None
    provider: Provider = Provider.UNKNOWN
    priority: int = 0
    blocked_by: tuple[str, ...] = ()
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "status": self.status.value,
            "session_id": self.session_id,
            "provider": self.provider.value,
            "priority": self.priority,
            "blocked_by": list(self.blocked_by),
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "Task":
        blocked_by_value = value.get("blocked_by", ())
        blocked_by: tuple[str, ...]
        if isinstance(blocked_by_value, (list, tuple)):
            blocked_by = tuple(str(item) for item in blocked_by_value)
        else:
            blocked_by = ()
        return cls(
            id=str(value.get("id", "")),
            title=str(value.get("title", "")),
            status=TaskStatus.from_value(str(value.get("status", ""))),
            session_id=str(value["session_id"]) if value.get("session_id") is not None else None,
            provider=Provider.from_value(str(value.get("provider", ""))),
            priority=int(value.get("priority", 0) or 0),
            blocked_by=blocked_by,
            metadata=dict(value.get("metadata", {}) or {}),
        )

