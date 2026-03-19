import pytest

from backend.backends import (
    engine_needs_trim,
    get_engine_config,
    get_model_config,
)
from backend.models import GenerationRequest, StoryBatchEntry, StoryItemRegenerateRequest


def test_model_registry_includes_new_tts_engines_and_whisper_turbo():
    assert get_model_config("luxtts") is not None
    assert get_model_config("chatterbox-tts") is not None
    assert get_model_config("chatterbox-turbo") is not None
    assert get_model_config("whisper-turbo") is not None


def test_engine_config_defaults_for_non_qwen_models():
    luxtts = get_engine_config("luxtts", "default")
    chatterbox = get_engine_config("chatterbox", "default")
    turbo = get_engine_config("chatterbox_turbo", "default")

    assert luxtts is not None and luxtts.model_name == "luxtts"
    assert chatterbox is not None and chatterbox.model_name == "chatterbox-tts"
    assert turbo is not None and turbo.model_name == "chatterbox-turbo"
    assert engine_needs_trim("chatterbox") is True
    assert engine_needs_trim("chatterbox_turbo") is True
    assert engine_needs_trim("luxtts") is False


def test_generation_request_normalizes_non_qwen_model_size():
    request = GenerationRequest(
        profile_id="profile-1",
        text="Hello world",
        language="en",
        engine="luxtts",
        model_size="1.7B",
        instruct="",
    )

    assert request.engine == "luxtts"
    assert request.model_size == "default"
    assert request.instruct is None


def test_story_requests_preserve_engine_defaults():
    regenerate = StoryItemRegenerateRequest(
        profile_id="profile-1",
        text="Line",
        language="en",
        engine="chatterbox",
        model_size="0.6B",
    )
    batch_entry = StoryBatchEntry(profile_name="Narrator", text="Line", engine="chatterbox_turbo")

    assert regenerate.engine == "chatterbox"
    assert regenerate.model_size == "default"
    assert batch_entry.engine == "chatterbox_turbo"
    assert batch_entry.model_size == "default"


def test_generation_request_rejects_unsupported_engine_language():
    with pytest.raises(ValueError, match="does not support language"):
        GenerationRequest(
            profile_id="profile-1",
            text="Hello world",
            language="ko",
            engine="luxtts",
        )
