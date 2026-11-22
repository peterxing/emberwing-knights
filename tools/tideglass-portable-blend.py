"""Package an existing Tideglass master for distribution, leaving the master untouched.

Run in background Blender with a master open and two arguments after --:
an empty, neutral staging directory outside your profile, then an output directory.
"""
from pathlib import Path
import os
import shutil
import sys

import bpy


def package(staging, output):
    if not bpy.app.background or not bpy.data.filepath:
        raise RuntimeError("Use background Blender with the original master open.")
    if any(staging.iterdir()):
        raise ValueError("An empty, separate staging directory is required.")
    if bpy.data.libraries or bpy.data.sounds or bpy.data.movieclips:
        raise ValueError("Unexpected external libraries or media.")
    # These are fixed-size DNA buffers. Assigning a shorter path alone can retain
    # the old directory after its NUL terminator in the serialized .blend.
    scrub = "//" + "_" * 300 + "/asset"
    for image in bpy.data.images:
        if image.source == 'FILE' and image.filepath:
            if not image.packed_file:
                raise ValueError("Missing packed image: " + image.name)
            name = Path(image.filepath).name
            image.filepath_raw = scrub
            image.filepath_raw = "//textures/" + name
            for packed in image.packed_files:
                packed.filepath = scrub
                packed.filepath = image.filepath_raw
    for text in bpy.data.texts:
        text.filepath = ""
    for scene in bpy.data.scenes:
        scene.render.filepath = "//render/"
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type == 'FILE_BROWSER' and space.params:
                    space.params.directory = scrub.encode()
                    space.params.directory = b"//"
    bpy.context.preferences.filepaths.save_version = 0
    dest = staging / "Tideglass.blend"
    kwargs = dict(filepath=str(dest), relative_remap=False, check_existing=False)
    bpy.ops.wm.save_as_mainfile(compress=False, **kwargs)
    raw = dest.read_bytes().lower()
    profile = os.environ.get("USERPROFILE") or str(Path.home())
    for term in (profile, profile.replace("\\", "/"), "OneDrive - Microsoft", ".scout\\", ".scout/"):
        if any(term.lower().encode(enc) in raw for enc in ("utf-8", "utf-16-le")):
            raise ValueError("The source contains an author-machine path; not publishing it.")
    bpy.ops.wm.save_as_mainfile(compress=True, **kwargs)
    output.mkdir(exist_ok=True, parents=True)
    shutil.copyfile(dest, output / dest.name)
    print("Portable Blender master:", dest.stat().st_size, "bytes")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    package(*(Path(value).resolve() for value in args))
