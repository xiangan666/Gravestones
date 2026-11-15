"""Structural and localization checks, independent of Minecraft and third-party libraries."""
from pathlib import Path
import json
import re
import uuid

ROOT = Path(__file__).resolve().parents[1]


def validate():
    count = 0
    for pack in ("Grave_B", "Grave_R"):
        for path in (ROOT / pack).rglob("*.json"):
            json.loads(path.read_text(encoding="utf-8-sig"))
            count += 1
    manifests = [json.loads((ROOT / pack / "manifest.json").read_text(encoding="utf-8")) for pack in ("Grave_B", "Grave_R")]
    expected = tuple(map(int, json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"].split(".")))
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    assert lock["version"] == lock["packages"][""]["version"] == package["version"]
    assert lock["packages"][""]["devDependencies"] == package["devDependencies"]
    seen = set()
    for manifest in manifests:
        assert tuple(manifest["header"]["version"]) == expected
        assert "lanshiyi" in manifest["metadata"]["authors"]
        assert "Effect99" in manifest["metadata"]["authors"]
        assert "3199912548@qq.com" in manifest["header"]["description"]
        for obj in [manifest["header"]] + manifest["modules"]:
            uuid.UUID(obj["uuid"])
            assert obj["uuid"] not in seen
            seen.add(obj["uuid"])
            assert tuple(obj["version"]) == expected
        for dep in manifest["dependencies"]:
            if "uuid" in dep:
                assert dep["uuid"] in [m["header"]["uuid"] for m in manifests]
                assert tuple(dep["version"]) == expected
    dependencies = {d["module_name"]: d["version"] for d in manifests[0]["dependencies"] if "module_name" in d}
    assert dependencies == {"@minecraft/server": "2.0.0", "@minecraft/server-ui": "2.0.0"}
    assert manifests[1]["header"]["uuid"] == "b17af4d5-486d-480e-8d1f-f864c9a33a20", "Preserve resource pack upgrade identity"
    assert manifests[0]["header"]["uuid"] == "0db99973-12b3-4c67-abbb-90e4726e73e1", "Preserve dynamic property ownership for upgrades"
    assert (ROOT / "Grave_B/scripts/grave.js").exists()
    version_text = ".".join(map(str, expected))
    assert f'export const VERSION = "{version_text}"' in (ROOT / "Grave_B/scripts/core.js").read_text(encoding="utf-8")

    atlas = json.loads((ROOT / "Grave_R/textures/item_texture.json").read_text(encoding="utf-8"))["texture_data"]
    item_ids = []
    for path in (ROOT / "Grave_B/items").glob("*.json"):
        item = json.loads(path.read_text(encoding="utf-8"))["minecraft:item"]
        item_ids.append(item["description"]["identifier"])
        assert item["components"]["minecraft:fire_resistant"]["value"] is True
        icon = item["components"]["minecraft:icon"]
        assert icon in atlas
        assert (ROOT / "Grave_R" / (atlas[icon]["textures"] + ".png")).exists()
        assert item["components"]["minecraft:max_stack_size"] == 1
        assert "lanshiyi:use" in item["components"]
    assert len(item_ids) == len(set(item_ids)) == 19
    for locale in json.loads((ROOT / "Grave_R/texts/languages.json").read_text(encoding="utf-8")):
        text = (ROOT / f"Grave_R/texts/{locale}.lang").read_text(encoding="utf-8")
        for identifier in item_ids:
            assert f"item.{identifier}=" in text, (locale, identifier)
        assert "\ufffd" not in text
    drop = json.loads((ROOT / "Grave_B/entities/grave_drop.json").read_text(encoding="utf-8"))["minecraft:entity"]["components"]
    assert "minecraft:persistent" in drop and "minecraft:fire_immune" in drop
    for entity_name in ("grave_inventory", "grave_storage", "grave_drop", "grave_vault_anchor"):
        entity = json.loads((ROOT / f"Grave_B/entities/{entity_name}.json").read_text(encoding="utf-8"))["minecraft:entity"]["components"]
        assert entity["minecraft:damage_sensor"]["triggers"] == [{"deals_damage": "no"}], "Modern entity formats require the string enum; an invalid boolean disables suffocation protection"
    assert 0 <= drop["minecraft:buoyant"]["base_buoyancy"] <= 1
    assert "minecraft:timer" not in drop and "minecraft:despawn" not in drop
    anchor = json.loads((ROOT / "Grave_B/entities/grave_vault_anchor.json").read_text(encoding="utf-8"))["minecraft:entity"]["components"]
    assert anchor["minecraft:tick_world"]["never_despawn"] is True
    assert 2 <= anchor["minecraft:tick_world"]["radius"] <= 6
    assert "minecraft:inventory" not in anchor, "The ticking anchor must never own grave contents"
    assert (ROOT / "Grave_R/entity/grave_vault_anchor.json").exists()
    for path in (ROOT / "Grave_B/blocks").glob("*.json"):
        block = json.loads(path.read_text(encoding="utf-8"))["minecraft:block"]
        assert block["components"]["minecraft:destructible_by_explosion"] is False
        assert block["components"]["minecraft:destructible_by_mining"]["seconds_to_destroy"] == 1
        assert all("minecraft:destructible_by_mining" not in p["components"] for p in block["permutations"])
    source = "\n".join(p.read_text(encoding="utf-8") for p in (ROOT / "Grave_B/scripts").glob("*.js"))
    assert not re.search(r"world\.(beforeEvents|afterEvents)\.worldInitialize", source)
    assert not re.search(r"\.isValid\(", source), "2.0 uses the isValid property"
    assert not re.search(r"\.isSolid\b", re.sub(r"//[^\n]*", "", source)), "Stable API 2.0 has no Block.isSolid; query native collisions instead"
    for old_ui in ("Place of death:", "You need a key", "R.I.P", "Gravestone unlocked", "You are not the owner"):
        assert old_ui not in source
    print(f"Validated {count} JSON files, {len(item_ids)} items, 4 Chinese language files, UUIDs, dependencies and persistence/protection definitions.")


if __name__ == "__main__":
    validate()
