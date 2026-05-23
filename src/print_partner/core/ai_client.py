"""HTTP clients for optional LLM providers (OpenAI, Anthropic, OpenAI-compatible)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

import httpx

from print_partner.core.ai_capabilities import ACTION_SCHEMA, workflow_manifest
from print_partner.core.ai_config import AiConfig

_SYSTEM_PROMPT = f"""You help curate 3D print part kits in Print Partner.

{workflow_manifest()}

{ACTION_SCHEMA}

Respond with a single JSON object only (no markdown fences):
{{"message": "explanation", "actions": [...]}}

Keep message under 400 words. User must confirm before actions run."""

_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


class AiClientError(Exception):
    pass


@dataclass
class AiAction:
    action_type: str = ""
    part_id: int = 0
    action: str = ""
    reason: str = ""
    filament_color_id: str | None = None
    role: str | None = None
    quantity: int | None = None
    notes: str | None = None
    target: str | None = None


@dataclass
class AiResponse:
    message: str
    actions: list[AiAction] = field(default_factory=list)


def complete(config: AiConfig, api_key: str, user_context: str, *, timeout: float = 90.0) -> AiResponse:
    if config.provider == "anthropic":
        raw = _complete_anthropic(config, api_key, user_context, timeout=timeout)
    else:
        raw = _complete_openai_compatible(config, api_key, user_context, timeout=timeout)
    return parse_ai_response(raw)


def parse_ai_response(raw: str) -> AiResponse:
    text = raw.strip()
    match = _JSON_BLOCK_RE.search(text)
    if match:
        text = match.group(1)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return AiResponse(message=raw.strip() or "Empty response from model.", actions=[])

    message = str(data.get("message") or "").strip() or raw.strip()
    actions: list[AiAction] = []
    for item in data.get("actions") or []:
        if not isinstance(item, dict):
            continue
        parsed = _parse_action_item(item)
        if parsed is not None:
            actions.append(parsed)
    return AiResponse(message=message, actions=actions)


def _parse_action_item(item: dict) -> AiAction | None:
    atype = str(item.get("type") or item.get("action") or "").strip().lower()
    if not atype:
        return None

    reason = str(item.get("reason") or "").strip()

    if atype in ("include", "exclude"):
        try:
            part_id = int(item["part_id"])
        except (KeyError, TypeError, ValueError):
            return None
        return AiAction(action_type=atype, part_id=part_id, action=atype, reason=reason)

    if atype == "set_filament":
        try:
            part_id = int(item["part_id"])
        except (KeyError, TypeError, ValueError):
            return None
        fid = str(item.get("filament_color_id") or "").strip()
        if not fid:
            return None
        return AiAction(
            action_type=atype,
            part_id=part_id,
            reason=reason,
            filament_color_id=fid,
        )

    if atype == "set_role":
        try:
            part_id = int(item["part_id"])
        except (KeyError, TypeError, ValueError):
            return None
        role = str(item.get("role") or "").strip()
        return AiAction(action_type=atype, part_id=part_id, role=role, reason=reason)

    if atype == "set_quantity":
        try:
            part_id = int(item["part_id"])
            qty = int(item["quantity"])
        except (KeyError, TypeError, ValueError):
            return None
        return AiAction(action_type=atype, part_id=part_id, quantity=qty, reason=reason)

    if atype == "set_notes":
        try:
            part_id = int(item["part_id"])
        except (KeyError, TypeError, ValueError):
            return None
        return AiAction(
            action_type=atype,
            part_id=part_id,
            notes=str(item.get("notes") or ""),
            reason=reason,
        )

    if atype == "assign_filament_to_role":
        role = str(item.get("role") or "").strip()
        fid = str(item.get("filament_color_id") or "").strip()
        if not role or not fid:
            return None
        return AiAction(
            action_type=atype,
            role=role,
            filament_color_id=fid,
            reason=reason,
        )

    if atype == "navigate":
        target = str(item.get("target") or "").strip().lower()
        if not target:
            return None
        return AiAction(action_type=atype, target=target, reason=reason)

    return None


def action_summary(action: AiAction) -> str:
    atype = action.action_type or action.action
    if atype in ("include", "exclude"):
        return f"{atype.title()} part {action.part_id}: {action.reason}"
    if atype == "set_filament":
        return f"Set filament on part {action.part_id} → {action.filament_color_id}"
    if atype == "set_role":
        return f"Set role on part {action.part_id} → {action.role}"
    if atype == "set_quantity":
        return f"Set qty on part {action.part_id} → {action.quantity}"
    if atype == "set_notes":
        return f"Set notes on part {action.part_id}"
    if atype == "assign_filament_to_role":
        return f"Assign {action.filament_color_id} to all {action.role} parts"
    if atype == "navigate":
        return f"Go to {action.target}"
    return f"{atype}: {action.reason or '—'}"


def _complete_openai_compatible(
    config: AiConfig, api_key: str, user_context: str, *, timeout: float
) -> str:
    if config.provider == "openai":
        base = "https://api.openai.com/v1"
    else:
        base = (config.base_url or "http://127.0.0.1:11434/v1").rstrip("/")
    url = f"{base}/chat/completions"
    payload: dict[str, Any] = {
        "model": config.model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_context},
        ],
        "temperature": 0.2,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise AiClientError(str(exc)) from exc
    choices = data.get("choices") or []
    if not choices:
        raise AiClientError("No choices in model response")
    return str(choices[0].get("message", {}).get("content") or "")


def _complete_anthropic(config: AiConfig, api_key: str, user_context: str, *, timeout: float) -> str:
    url = "https://api.anthropic.com/v1/messages"
    payload = {
        "model": config.model or "claude-3-5-haiku-20241022",
        "max_tokens": 2048,
        "system": _SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_context}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise AiClientError(str(exc)) from exc
    blocks = data.get("content") or []
    parts = [b.get("text", "") for b in blocks if b.get("type") == "text"]
    return "\n".join(parts).strip()
