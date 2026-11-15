"""Generate the Chinese metadata and small pixel-art finder sprites (Pillow required)."""
from pathlib import Path
import json
import math
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
VERSION = [int(part) for part in json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"].split(".")]


def write_json(path, value):
    path = ROOT / path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    # Blank keys cannot inherit a binding through a native crafting recipe.
    (ROOT / "Grave_B/recipes/key.json").unlink(missing_ok=True)
    for pack in ("Grave_B", "Grave_R"):
        path = ROOT / pack / "manifest.json"
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        data["header"].update(name=f"§l§7墓碑模组 §r{'.'.join(map(str, VERSION))} · 汉化二改", description="原作 Effect99 | 汉化二改 lanshiyi | 3199912548@qq.com", version=VERSION, min_engine_version=[1, 21, 90])
        for module in data["modules"]:
            module["version"] = VERSION
        for dependency in data.get("dependencies", []):
            dependency["version"] = "2.0.0" if "module_name" in dependency else VERSION
        if pack == "Grave_B" and not any(d.get("module_name") == "@minecraft/server-ui" for d in data["dependencies"]):
            data["dependencies"].append({"module_name": "@minecraft/server-ui", "version": "2.0.0"})
        data["metadata"] = {"product_type": "addon", "authors": ["Effect99", "lanshiyi"]}
        write_json(path, data)

    for path in sorted((ROOT / "Grave_B/blocks").glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        block = data["minecraft:block"]
        if "menu_category" in block["description"]:
            block["description"]["menu_category"]["category"] = "construction"
        block["components"].pop("minecraft:custom_components", None)
        block["components"]["minecraft:destructible_by_mining"] = {"seconds_to_destroy": 1}
        block["components"]["minecraft:loot"] = "loot_tables/empty.json"
        block["permutations"] = [p for p in block["permutations"] if "minecraft:destructible_by_mining" not in p["components"]]
        write_json(path, data)
    write_json("Grave_B/loot_tables/empty.json", {"pools": []})

    def item(identifier, icon, group=True):
        return {"format_version": "1.21.90", "minecraft:item": {"description": {"identifier": identifier, **({"menu_category": {"category": "equipment"}} if group else {})}, "components": {"minecraft:max_stack_size": 1, "minecraft:icon": icon, "minecraft:glint": True, "minecraft:fire_resistant": {"value": True}, "minecraft:allow_off_hand": False, "minecraft:hand_equipped": False, "minecraft:can_destroy_in_creative": False, "minecraft:use_modifiers": {"use_duration": 0.1, "movement_modifier": 1}, "lanshiyi:use": {}}}}
    write_json("Grave_B/items/key.json", item("effect99:key", "key"))
    write_json("Grave_B/items/admin_key.json", item("effect99:admin_key", "admin_key"))
    write_json("Grave_B/items/gravestone.json", item("lanshiyi:gravestone", "gravestone"))
    for frame in range(16):
        write_json(f"Grave_B/items/finder_{frame}.json", item(f"lanshiyi:finder_{frame}", f"grave_finder_{frame}", frame == 0))

    # Modern entity format versions require the string enum, not the old boolean.
    # An unfiltered trigger covers suffocation inside the underground vault too.
    common = {"minecraft:type_family": {"family": ["inanimate", "lanshiyi_grave"]}, "minecraft:health": {"value": 20, "max": 20}, "minecraft:damage_sensor": {"triggers": [{"deals_damage": "no"}]}, "minecraft:fire_immune": {}, "minecraft:persistent": {}, "minecraft:knockback_resistance": {"value": 1}, "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False}, "minecraft:collision_box": {"width": 0, "height": 0}, "minecraft:physics": {"has_gravity": False, "has_collision": False}, "minecraft:nameable": {"allow_name_tag_renaming": False, "always_show": True}, "minecraft:inventory": {"inventory_size": 42, "container_type": "inventory", "can_be_siphoned_from": False, "private": True}}
    for name, identifier in (("grave_inventory", "entity:grave_inventory"), ("grave_storage", "lanshiyi:grave_storage"), ("grave_drop", "lanshiyi:grave_drop")):
        components = json.loads(json.dumps(common))
        if name == "grave_drop":
            components["minecraft:inventory"]["inventory_size"] = 1
            components["minecraft:collision_box"] = {"width": 0.4, "height": 0.5}
            components["minecraft:physics"] = {"has_gravity": True, "has_collision": True}
            components["minecraft:buoyant"] = {"apply_gravity": True, "base_buoyancy": 1.0, "simulate_waves": False, "liquid_blocks": ["minecraft:lava", "minecraft:flowing_lava", "minecraft:water", "minecraft:flowing_water"]}
        write_json(f"Grave_B/entities/{name}.json", {"format_version": "1.21.90", "minecraft:entity": {"description": {"identifier": identifier, "is_summonable": True, "is_spawnable": False}, "components": components}})
        write_json(f"Grave_R/entity/{name}.json", {"format_version": "1.10.0", "minecraft:client_entity": {"description": {"identifier": identifier, "materials": {"default": "entity_alphatest"}, "textures": {"default": "textures/blocks/stone_grave" if name == "grave_drop" else "textures/entity/transparent"}, "geometry": {"default": "geometry.grave_drop" if name == "grave_drop" else "geometry.text"}, "render_controllers": ["controller.render.default"]}}})
    anchor = json.loads(json.dumps(common))
    anchor.pop("minecraft:inventory")
    anchor["minecraft:tick_world"] = {"radius": 2, "never_despawn": True}
    write_json("Grave_B/entities/grave_vault_anchor.json", {"format_version": "1.21.90", "minecraft:entity": {"description": {"identifier": "lanshiyi:grave_vault_anchor", "is_summonable": True, "is_spawnable": False}, "components": anchor}})
    write_json("Grave_R/entity/grave_vault_anchor.json", {"format_version": "1.10.0", "minecraft:client_entity": {"description": {"identifier": "lanshiyi:grave_vault_anchor", "materials": {"default": "entity_alphatest"}, "textures": {"default": "textures/entity/transparent"}, "geometry": {"default": "geometry.text"}, "render_controllers": ["controller.render.default"]}}})
    write_json("Grave_R/models/entity/grave_drop.geo.json", {"format_version": "1.12.0", "minecraft:geometry": [{"description": {"identifier": "geometry.grave_drop", "texture_width": 32, "texture_height": 32, "visible_bounds_width": 1, "visible_bounds_height": 1, "visible_bounds_offset": [0, 0.3, 0]}, "bones": [{"name": "root", "pivot": [0, 0, 0], "cubes": [{"origin": [-3, 0, -1], "size": [6, 8, 2], "uv": [0, 0]}, {"origin": [-4, 0, -2], "size": [8, 2, 4], "uv": [0, 12]}]}]}]})
    write_json("Grave_R/models/entity/text.geo.json", {"format_version": "1.12.0", "minecraft:geometry": [{"description": {"identifier": "geometry.text", "texture_width": 1, "texture_height": 1, "visible_bounds_width": 2, "visible_bounds_height": 3, "visible_bounds_offset": [0, 1, 0]}, "bones": [{"name": "root", "pivot": [0, 0, 0]}]}]})
    transparent = ROOT / "Grave_R/textures/entity/transparent.png"
    transparent.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(transparent)

    atlas = json.loads((ROOT / "Grave_R/textures/item_texture.json").read_text(encoding="utf-8-sig"))
    for frame in range(16):
        im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        draw = ImageDraw.Draw(im)
        draw.ellipse((2, 2, 29, 29), fill="#272c3c", outline="#c9b57a", width=2)
        draw.ellipse((5, 5, 26, 26), outline="#72788b")
        for x, y in ((16, 6), (25, 16), (16, 25), (6, 16)):
            draw.rectangle((x-1, y-1, x+1, y+1), fill="#e3dcc5")
        a = frame * math.pi / 8
        def point(radius, angle):
            return (round(15.5 + radius * math.sin(angle)), round(15.5 - radius * math.cos(angle)))
        draw.polygon([point(10, a), point(3, a + math.pi / 2), point(0, a), point(3, a - math.pi / 2)], fill="#eb5757")
        draw.polygon([point(8, a + math.pi), point(3, a + math.pi / 2), point(0, a), point(3, a - math.pi / 2)], fill="#e0e5ee")
        draw.rectangle((15, 15, 16, 16), fill="#f4dc83")
        im.save(ROOT / f"Grave_R/textures/items/grave_finder_{frame}.png")
        atlas["texture_data"][f"grave_finder_{frame}"] = {"textures": f"textures/items/grave_finder_{frame}"}
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((7, 3, 24, 26), radius=5, fill="#929aa7", outline="#414753", width=2)
    d.rectangle((4, 25, 27, 29), fill="#606a76", outline="#414753")
    d.rectangle((15, 8, 17, 20), fill="#deded1")
    d.rectangle((11, 12, 21, 14), fill="#deded1")
    im.save(ROOT / "Grave_R/textures/items/gravestone.png")
    atlas["texture_data"]["gravestone"] = {"textures": "textures/items/gravestone"}
    write_json("Grave_R/textures/item_texture.json", atlas)

    names = {"grave": "墓碑", "wooden_grave": "木制墓碑", "stone_grave": "石制墓碑", "stone_slab_grave": "石板墓碑", "stone_cross_grave": "石制十字墓碑", "blackstone_grave": "黑石墓碑", "golden_blackstone_grave": "镀金黑石墓碑", "golden_cross_netherite_grave": "镀金下界合金十字墓碑", "golden_netherite_grave": "镀金下界合金墓碑"}
    lines = ["## 原作 Effect99；简体中文汉化二改 lanshiyi；3199912548@qq.com"]
    lines += [f"tile.effect99:{key}.name=§7{value}" for key, value in names.items()]
    lines += ["itemGroup.name.effectoo.graves=墓碑", "minecraft:itemGroup.name.effectoo.graves=墓碑"]
    for identifier, name in [("effect99:key", "墓碑钥匙"), ("effect99:admin_key", "管理员墓碑钥匙"), ("lanshiyi:gravestone", "可搬运墓碑")] + [(f"lanshiyi:finder_{frame}", "寻墓器") for frame in range(16)]:
        lines += [f"item.{identifier}=§e{name}", f"item.{identifier}.name=§e{name}"]
    lines += ["entity.entity:grave_inventory.name=墓碑悬浮文本", "entity.lanshiyi:grave_storage.name=墓碑保险库", "entity.lanshiyi:grave_drop.name=墓碑掉落物", "entity.lanshiyi:grave_vault_anchor.name=墓碑保险库常加载锚点"]
    text = "\n".join(lines) + "\n"
    for locale in ("zh_CN", "en_US", "it_IT", "zh_TW"):
        (ROOT / f"Grave_R/texts/{locale}.lang").write_text(text, encoding="utf-8")
    write_json("Grave_R/texts/languages.json", ["zh_CN", "en_US", "zh_TW", "it_IT"])
    print("Generated Chinese pack metadata, protected entities, 16 finder frames and item definitions.")


if __name__ == "__main__":
    main()
