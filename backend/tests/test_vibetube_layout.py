from backend import vibetube


def test_single_avatar_slot_keeps_same_size_across_aspect_ratios():
    square = vibetube._single_avatar_slot(width=1080, height=1080)
    portrait = vibetube._single_avatar_slot(width=1080, height=1920)
    landscape = vibetube._single_avatar_slot(width=1920, height=1080)

    assert square["width"] == portrait["width"] == landscape["width"]
    assert square["height"] == portrait["height"] == landscape["height"]


def test_single_avatar_slot_stays_inside_canvas_bounds():
    slot = vibetube._single_avatar_slot(width=720, height=1280, reserve_bottom_ratio=0.16)

    assert slot["x"] >= 0
    assert slot["y"] >= 0
    assert slot["width"] > 0
    assert slot["height"] > 0
    assert slot["x"] + slot["width"] <= 720
    assert slot["y"] + slot["height"] <= 1280
