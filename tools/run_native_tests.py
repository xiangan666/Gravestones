"""Run two bounded BDS sessions in a fresh, disposable world (Windows only).

Pass an official Windows BDS ZIP. Never points at, edits, or deletes a user world.
Native containers and a player facade exercise item persistence and claims;
real Player death/input/UI/teleport must still be checked in a client.
"""
from pathlib import Path
import argparse
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]


def session(server, phase):
    log = server.parent / f"phase-{phase}.log"
    process = subprocess.Popen(
        [str(server / "bedrock_server.exe")], cwd=server, stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    lines = queue.Queue()

    def read():
        with log.open("wb") as output:
            for line in iter(process.stdout.readline, b""):
                output.write(line)
                output.flush()
                lines.put(line.decode("utf-8", "replace"))

    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    passed, errors = False, []
    deadline = time.monotonic() + 60
    try:
        while time.monotonic() < deadline and process.poll() is None:
            try:
                line = lines.get(timeout=1)
            except queue.Empty:
                continue
            if "NATIVE_" in line or "Version:" in line:
                print(line.rstrip(), flush=True)
            if "NATIVE_FAIL" in line or "[ERROR]" in line or " ERROR] [Json]" in line or " ERROR] [Components]" in line or " ERROR] [Scripting]" in line:
                errors.append(line.strip())
                print(line.rstrip(), flush=True)
            if f"NATIVE_PHASE{phase}_PASS" in line:
                passed = True
                break
            if "NATIVE_FAIL" in line:
                break
    finally:
        if process.poll() is None:
            process.stdin.write(b"stop\n")
            process.stdin.flush()
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        reader.join(timeout=5)
    if not passed or errors or process.returncode:
        raise RuntimeError(f"Native phase {phase} failed; see {log}. Errors: {errors}")
    print(f"Native phase {phase} passed; log: {log}", flush=True)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server-zip", type=Path, required=True)
    args = parser.parse_args()
    if os.name != "nt":
        parser.error("This harness requires the official Windows BDS build.")
    run = ROOT / ".native-test" / f"run-{time.time_ns()}"
    server = run / "server"
    server.mkdir(parents=True)
    with ZipFile(args.server_zip) as archive:
        archive.extractall(server)
    for pack, folder in (("Grave_B", "behavior_packs"), ("Grave_R", "resource_packs")):
        shutil.copytree(ROOT / pack, server / folder / pack)
    script = server / "behavior_packs/Grave_B/scripts/grave.js"
    with script.open("a", encoding="utf-8") as f:
        f.write('\nimport "./native-probe.js";\n')
    shutil.copy2(ROOT / "tools/native-probe.js", script.with_name("native-probe.js"))
    world = server / "worlds/NativeRegression"
    world.mkdir(parents=True)
    for pack, kind in (("Grave_B", "behavior"), ("Grave_R", "resource")):
        header = json.loads((ROOT / pack / "manifest.json").read_text(encoding="utf-8"))["header"]
        (world / f"world_{kind}_packs.json").write_text(json.dumps([{"pack_id": header["uuid"], "version": header["version"]}]), encoding="utf-8")
    (server / "server.properties").write_text("\n".join([
        "server-name=Grave native regression", "level-name=NativeRegression", "level-seed=1",
        "allow-cheats=true", "allow-list=true", "max-players=1", "online-mode=true",
        "enable-lan-visibility=false", "server-port=29991", "server-portv6=29992",
        "server-ip=127.0.0.1", "server-udp-ports=127.0.0.1:29991:29991", "transport=nethernet",
        "view-distance=5", "tick-distance=4", "content-log-file-enabled=true",
        "content-log-console-output-enabled=true", "emit-server-telemetry=false", "gamemode=survival",
    ]) + "\n", encoding="utf-8")
    print(f"Disposable server: {server}", flush=True)
    session(server, 1)
    session(server, 2)
    print("Native inventory persistence, claims and landing regression passed.", flush=True)


if __name__ == "__main__":
    main()
