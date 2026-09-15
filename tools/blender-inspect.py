# Independent mesh inspection and overview renders in Blender (not part of the core).
#
#   blender -b --factory-startup --python tools/blender-inspect.py -- OUT_DIR MODEL.stl [MODEL.stl ...]
#
# For every STL prints one line "INSPECT {json}" and writes OUT_DIR/<name>.png.
# Self-intersections use BVHTree.overlap of the mesh with itself: triangle pairs that
# share an edge are skipped, pairs sharing one vertex count only if they cross along a
# segment longer than the tree epsilon. Touching without crossing is not reported.

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

MERGE_DISTANCE = 1e-5  # STL stores float32, shared vertices are bit-identical
BED_TOLERANCE = 1e-4
OVERHANG_LIMIT = math.radians(45)


def main():
    args = sys.argv[sys.argv.index("--") + 1:]
    out_dir, paths = args[0], args[1:]
    os.makedirs(out_dir, exist_ok=True)
    for path in paths:
        name = os.path.splitext(os.path.basename(path))[0]
        obj = import_stl(path)
        report = inspect(obj)
        report["file"] = path
        render(obj, os.path.join(out_dir, name + ".png"))
        print("INSPECT " + json.dumps(report), flush=True)
        bpy.data.objects.remove(obj, do_unlink=True)


def import_stl(path):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.wm.stl_import(filepath=path)
    return bpy.context.selected_objects[0]


def inspect(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    imported = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=MERGE_DISTANCE)
    bm.normal_update()

    tree = BVHTree.FromBMesh(bm, epsilon=0.0)
    intersecting = tree.overlap(tree)
    non_manifold_edges = sum(1 for edge in bm.edges if len(edge.link_faces) != 2)
    non_manifold_verts = sum(1 for vert in bm.verts if not vert.is_manifold)
    bed = min(vert.co.z for vert in bm.verts)
    overhang = 0.0
    for face in bm.faces:
        tilt = face.normal.angle(Vector((0, 0, -1)), 0.0)
        if tilt < OVERHANG_LIMIT and min(v.co.z for v in face.verts) > bed + BED_TOLERANCE:
            overhang += face.calc_area()
    report = {
        "importedVertices": imported,
        "vertices": len(bm.verts),
        "triangles": len(bm.faces),
        "nonManifoldEdges": non_manifold_edges,
        "nonManifoldVertices": non_manifold_verts,
        "selfIntersectingPairs": len(intersecting),
        "volume": bm.calc_volume(signed=True),
        "overhangArea": overhang,
        "size": list(obj.dimensions),
    }
    bm.free()
    return report


def render(obj, path):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.85, 0.55, 0.2)
    scene.display.shading.show_cavity = True
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    scene.render.film_transparent = False
    scene.world = scene.world or bpy.data.worlds.new("World")
    scene.world.color = (0.96, 0.96, 0.96)

    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    center = sum(corners, Vector()) / 8
    radius = max((corner - center).length for corner in corners)

    camera_data = bpy.data.cameras.new("inspect")
    camera_data.lens = 50
    camera = bpy.data.objects.new("inspect", camera_data)
    scene.collection.objects.link(camera)
    direction = Vector((0.55, -0.8, 0.9)).normalized()
    camera.location = center + direction * radius * 3.4
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera

    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)


main()
