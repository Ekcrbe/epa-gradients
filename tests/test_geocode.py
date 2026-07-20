from pipeline import geocode


def test_zip_centroid_format_validation(monkeypatch):
    # No network / cache file needed for these -- they're rejected before lookup.
    assert geocode.zip_centroid(None) is None
    assert geocode.zip_centroid("") is None
    assert geocode.zip_centroid("abc") is None
    assert geocode.zip_centroid("123") is None


def test_zip_centroid_looks_up_and_truncates_zip4(monkeypatch):
    monkeypatch.setattr(geocode, "_centroids", {"95126": (37.33, -121.92)})
    assert geocode.zip_centroid("95126") == (37.33, -121.92)
    assert geocode.zip_centroid("95126-1234") == (37.33, -121.92)
    assert geocode.zip_centroid("99999") is None
