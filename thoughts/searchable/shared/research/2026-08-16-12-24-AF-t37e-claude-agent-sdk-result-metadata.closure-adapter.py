"""Staged executable specification for AF-t37e metadata selection.

This research artifact is deliberately not imported by production code.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelUsage:
    input_tokens: int
    output_tokens: int
    context_window: int
    max_output_tokens: int
    canonical_model: str | None = None


@dataclass(frozen=True)
class SelectedModel:
    raw_model: str
    usage: ModelUsage


def select_model(
    model_usage: dict[str, ModelUsage], preferred_model: str | None
) -> SelectedModel | None:
    """Mirror the planned exact-key, canonical-key, sole-entry policy."""
    sole_entry: SelectedModel | None = None
    canonical_match: SelectedModel | None = None
    canonical_match_count = 0

    for raw_model, usage in model_usage.items():
        candidate = SelectedModel(raw_model=raw_model, usage=usage)
        sole_entry = candidate if sole_entry is None else None
        if preferred_model is not None and preferred_model == raw_model:
            return candidate
        if preferred_model is not None and usage.canonical_model == preferred_model:
            canonical_match = candidate
            canonical_match_count += 1

    if canonical_match_count == 1:
        return canonical_match
    if len(model_usage) == 1:
        return sole_entry
    return None
