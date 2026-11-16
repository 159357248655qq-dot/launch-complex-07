# -*- coding: utf-8 -*-
"""Build a launch complex in Blender, export GLB for three.js.
All layout authored in three.js coords (X east, Y up, Z south); converted to Blender (x,-z,y)."""
import bpy, bmesh, json, math, os
from mathutils import Matrix, Vector

def T(p):            # three -> blender position
    return (p[0], -p[2], p[1])

def S(s):            # three size -> blender size
    return (s[0], s[2], s[1])

def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes): bpy.data.meshes.remove(m)
    for mt in list(bpy.data.materials): bpy.data.materials.remove(mt)

def mat(name, color, rough=0.7, metal=0.0, emit=None, emit_strength=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    return m

class Batch:
    def __init__(self, name, material):
        self.bm = bmesh.new(); self.name = name; self.material = material
        self.tris = 0
    def box(self, size, center, rz=0.0, rx=0.0):
        m = (Matrix.Translation(T(center))
             @ Matrix.Rotation(-rz, 4, 'Z') @ Matrix.Rotation(-rx, 4, 'X')
             @ Matrix.Diagonal((*S(size), 1.0)))
        bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
    def cyl(self, r, h, center, seg=16, r2=None, axis='Y'):
        """axis 'Y' = vertical in three space."""
        r2 = r if r2 is None else r2
        before = set(self.bm.verts)
        bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg,
                              radius1=r, radius2=r2, depth=h,
                              matrix=Matrix.Translation(T(center)))
        rot = {'Y': Matrix.Identity(3),                                  # three Y -> blender Z
               'X': Matrix.Rotation(math.radians(90), 3, 'Y'),            # three X -> blender X
               'Z': Matrix.Rotation(math.radians(90), 3, 'X')}[axis]      # three Z -> blender -Y
        bmesh.ops.rotate(self.bm, verts=[v for v in self.bm.verts if v not in before],
                         cent=T(center), matrix=rot)
    def sphere(self, r, center, seg=16, rings=8):
        m = Matrix.Translation(T(center)) @ Matrix.Diagonal((r, r, r, 1.0))
        bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=1.0, matrix=m)
    def finish(self, loc3=(0, 0, 0)):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me); self.bm.free()
        me.materials.append(self.material)
        for p in me.polygons: p.use_smooth = False
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = T(loc3)
        return ob

clear()

# ---------------------------------------------------------------- materials
M_CONC   = mat("Concrete", (0.30, 0.30, 0.31), 0.95)
M_CONC2  = mat("ConcreteDark", (0.17, 0.17, 0.18), 0.95)
M_STEEL  = mat("Steel", (0.44, 0.46, 0.49), 0.55, 0.85)
M_STEELD = mat("SteelDark", (0.13, 0.14, 0.16), 0.45, 0.9)
M_RED    = mat("SafetyRed", (0.62, 0.10, 0.08), 0.6, 0.2)
M_WHITE  = mat("RocketWhite", (0.86, 0.87, 0.88), 0.42, 0.15)
M_BLACK  = mat("Nozzle", (0.06, 0.06, 0.07), 0.35, 0.95)
M_TANK   = mat("TankWhite", (0.80, 0.82, 0.84), 0.35, 0.3)
M_LAMP   = mat("Lamp", (1.0, 0.93, 0.72), 0.2, 0.0, emit=(1.0, 0.86, 0.55), emit_strength=12)
M_YELLOW = mat("SafetyYellow", (0.72, 0.55, 0.08), 0.7, 0.2)

# ---------------------------------------------------------------- layout
PAD_TOP   = 6.0
DECK      = 46.0
TRENCH_W  = 13.0
MOUNT_TOP = 12.0
TOWER_X   = -13.0     # tower centre X
TOWER_H   = 92.0
TOWER_W   = 12.0
ROCKET_BASE = 12.6

# ---------------------------------------------------------------- pad
pad = Batch("Pad_Concrete", M_CONC)
half = DECK / 2
for sx in (-1, 1):                      # two slabs either side of the flame trench
    pad.box((half - TRENCH_W / 2, PAD_TOP, DECK), (sx * (half + TRENCH_W / 2) / 2, PAD_TOP / 2, 0))
pad.box((DECK, PAD_TOP, half - TRENCH_W / 2), (0, PAD_TOP / 2, -(TRENCH_W / 2 + (half - TRENCH_W / 2) / 2)))
pad.box((DECK, PAD_TOP, half - TRENCH_W / 2), (0, PAD_TOP / 2, (TRENCH_W / 2 + (half - TRENCH_W / 2) / 2)))
pad.box((DECK + 10, 0.6, DECK + 10), (0, -0.3, 0))          # apron
# blast deflector wedge (stepped boxes)
for i in range(6):
    h = 1.2 + i * 1.0
    pad.box((TRENCH_W - 1.0, h, 3.0), (0, h / 2 - 0.2, 2.5 + i * 2.6))
# mount legs + table
for sx in (-1, 1):
    for sz in (-1, 1):
        pad.box((2.2, MOUNT_TOP - PAD_TOP, 2.2),
                (sx * 6.0, PAD_TOP + (MOUNT_TOP - PAD_TOP) / 2, sz * 6.0))
# 发射台架：中间必须开孔。真实发射台火箭下方是排气通道，实心台面会把
# 尾焰和烟整个压在板下 —— 这就是之前怎么调 shader 都看不见尾焰的根因。
# 台架顶面必须正好等于 MOUNT_TOP(=12.0)，箭底在 12.6，压到板上就看不见喷口了
HOLE = 12.0                     # 中央排气口尺寸（尾焰底径约 11 m，必须能穿过）
for sz in (-1, 1):               # 前后两根横梁
    pad.box((17, 1.4, (17 - HOLE) / 2), (0, MOUNT_TOP - 0.7, sz * (HOLE + (17 - HOLE) / 2) / 2))
for sx in (-1, 1):               # 左右两根纵梁
    pad.box(((17 - HOLE) / 2, 1.4, HOLE), (sx * (HOLE + (17 - HOLE) / 2) / 2, MOUNT_TOP - 0.7, 0))
# 下层加强环，同样留出排气口
for sz in (-1, 1):
    pad.box((13, 1.0, (13 - HOLE) / 2), (0, MOUNT_TOP - 1.9, sz * (HOLE + (13 - HOLE) / 2) / 2))
for sx in (-1, 1):
    pad.box(((13 - HOLE) / 2, 1.0, HOLE), (sx * (HOLE + (13 - HOLE) / 2) / 2, MOUNT_TOP - 1.9, 0))
# hold-down clamps
for a in range(8):
    ang = a * math.pi / 4
    pad.box((1.5, 2.6, 1.5), (3.6 * math.cos(ang), MOUNT_TOP + 1.3, 3.6 * math.sin(ang)))
pad.finish()

# ---------------------------------------------------------------- tower
tw = Batch("Tower_Steel", M_STEEL)
tr = Batch("Tower_Red", M_RED)
tower_bottom = PAD_TOP
leg_r = 0.55
xs = (TOWER_X - TOWER_W / 2, TOWER_X + TOWER_W / 2)
zs = (-TOWER_W / 2, TOWER_W / 2)
for x in xs:
    for z in zs:
        tw.box((leg_r * 2, TOWER_H, leg_r * 2), (x, tower_bottom + TOWER_H / 2, z))
levels = 19
step = TOWER_H / levels
for i in range(levels + 1):
    y = tower_bottom + i * step
    for z in zs:                                        # X-direction beams
        tw.box((TOWER_W, 0.34, 0.34), (TOWER_X, y, z))
    for x in xs:                                        # Z-direction beams
        tw.box((0.34, 0.34, TOWER_W), (x, y, 0))
    if i < levels:                                      # X braces on the 4 faces
        d = math.hypot(TOWER_W, step)
        ang = math.atan2(step, TOWER_W)
        for z in zs:
            for sgn in (-1, 1):
                tw.box((d, 0.26, 0.26), (TOWER_X, y + step / 2, z), rz=sgn * ang)
        for x in xs:
            for sgn in (-1, 1):
                tw.box((0.26, d, 0.26), (x, y + step / 2, 0), rx=sgn * ang)
# platforms with railings
for lvl in (6, 11, 15, 18):
    y = tower_bottom + lvl * step
    tw.box((TOWER_W + 1.6, 0.35, TOWER_W + 1.6), (TOWER_X, y, 0))
    for dx, dz, sx_, sz_ in ((0, 1, TOWER_W + 1.6, 0.16), (0, -1, TOWER_W + 1.6, 0.16),
                             (1, 0, 0.16, TOWER_W + 1.6), (-1, 0, 0.16, TOWER_W + 1.6)):
        for hh in (0.55, 1.05):
            tw.box((sx_, 0.12, sz_), (TOWER_X + dx * (TOWER_W + 1.6) / 2, y + hh, dz * (TOWER_W + 1.6) / 2))
# crane + lightning mast on the roof
tw.box((TOWER_W + 3, 0.5, 1.2), (TOWER_X, tower_bottom + TOWER_H + 0.4, 0))
tw.cyl(0.35, 18, (TOWER_X, tower_bottom + TOWER_H + 9, 0), seg=8, r2=0.10)
tr.box((TOWER_W, 6.0, 0.25), (TOWER_X, tower_bottom + TOWER_H - 3.0, TOWER_W / 2))
tr.box((TOWER_W, 6.0, 0.25), (TOWER_X, tower_bottom + TOWER_H - 3.0, -TOWER_W / 2))
for i in range(3):
    tw.box((TOWER_W, 0.3, 0.3), (TOWER_X, tower_bottom + TOWER_H - 5.6 + i * 1.2, 0))
tw.finish(); tr.finish()

# ---------------------------------------------------------------- umbilical arms (separate, hinged)
arms = []
for name, ay, alen in (("Arm_Low", 20.0, 4.4), ("Arm_Mid", 34.0, 4.4), ("Arm_High", 48.0, 4.4)):
    b = Batch(name, M_STEELD)
    b.box((alen, 1.5, 1.5), (alen / 2, 0, 0))
    b.box((0.5, 0.5, 3.4), (alen * 0.55, -1.4, 0))
    b.box((0.5, 0.5, 3.4), (alen * 0.55, 1.4, 0))
    b.box((1.1, 2.0, 2.0), (alen - 0.6, 0, 0))
    ob = b.finish(loc3=(TOWER_X + TOWER_W / 2, ay, 0))
    arms.append(ob)

# ---------------------------------------------------------------- rocket
# Split into stackable nodes so the page can stage-separate / jettison:
#   Booster_L1..L4  four strap-on boosters (origin at the booster axis base)
#   Stage1          core first stage + skirt + raceway
#   Stage2          upper stage + fairing + payload (origin at interstage)
H_CORE = 46.0
CORE_R = 2.6
STAGE2_Y = 47.5          # interstage plane above the rocket datum

s1 = Batch("Stage1", M_WHITE)
s1.cyl(CORE_R, H_CORE, (0, H_CORE / 2, 0), seg=28)
s1.cyl(CORE_R + 0.18, 1.2, (0, 1.6, 0), seg=28)                       # aft skirt ring
s1.box((0.55, H_CORE - 4, 0.55), (0, H_CORE / 2, -CORE_R - 0.2))      # raceway
for a in range(4):
    ang = a * math.pi / 2 + math.pi / 4
    s1.box((0.9, 1.6, 0.9), (CORE_R * math.cos(ang), 40.0, CORE_R * math.sin(ang)))
s1.finish(loc3=(0, ROCKET_BASE, 0))

s2 = Batch("Stage2", M_WHITE)
s2.cyl(CORE_R, 3.0, (0, 1.5, 0), seg=28)                              # interstage
s2.cyl(3.4, 8.0, (0, 7.0, 0), seg=28, r2=3.4)                         # upper stage tank
s2.cyl(3.4, 1.0, (0, 11.5, 0), seg=28, r2=3.4)
s2.cyl(3.4, 9.0, (0, 16.5, 0), seg=28, r2=1.9)                        # fairing ogive
s2.cyl(1.9, 2.2, (0, 22.1, 0), seg=28, r2=0.05)                       # nose tip
s2.finish(loc3=(0, ROCKET_BASE + STAGE2_Y, 0))

noz = Batch("Rocket_Nozzles", M_BLACK)
noz.cyl(2.3, 3.2, (0, 1.4, 0), seg=26, r2=1.05)
noz.box((CORE_R * 2, 0.8, 0.8), (0, 3.6, 0))
noz.finish(loc3=(0, ROCKET_BASE, 0))

# four strap-on boosters, each its own node hinged at its own axis
for i in range(4):
    ang = i * math.pi / 2 + math.pi / 4
    bx, bz = 5.1 * math.cos(ang), 5.1 * math.sin(ang)
    bs = Batch("Booster_L%d" % (i + 1), M_WHITE)
    bs.cyl(1.75, 25.0, (0, 12.5, 0), seg=22)
    bs.cyl(1.75, 3.0, (0, 27.2, 0), seg=22, r2=1.05)                  # nose cone
    bs.cyl(0.6, 1.6, (0, 29.4, 0), seg=12, r2=0.05)                   # tip
    bs.cyl(1.45, 2.6, (0, -1.0, 0), seg=18, r2=0.75)                  # nozzle (black below)
    bs.finish(loc3=(bx, ROCKET_BASE, bz))

# ---------------------------------------------------------------- ground support
tk = Batch("Tanks", M_TANK)
tk.sphere(7.0, (-44, 7.5, 22), seg=24, rings=14)
tk.sphere(6.0, (40, 6.5, 26), seg=24, rings=14)
for i, (x, z) in enumerate(((-44, 22), (40, 26))):
    for sx in (-1, 1):
        for sz in (-1, 1):
            tk.box((1.0, 5.0, 1.0), (x + sx * 5.0, 2.5, z + sz * 5.0))
tk.cyl(4.2, 22, (46, 11, -18), seg=20, r2=4.2)                      # water tower tank
for sx in (-1, 1):
    for sz in (-1, 1):
        tk.box((0.9, 22, 0.9), (46 + sx * 3.2, 11, -18 + sz * 3.2))
tk.cyl(0.55, 3.0, (46, 24.5, -18), seg=10, r2=0.55)                 # riser stub
tk.finish()

det = Batch("Masts", M_STEEL)
for a in range(4):                                                   # floodlight masts
    ang = a * math.pi / 2 + math.pi / 4
    x, z = 30 * math.cos(ang), 30 * math.sin(ang)
    det.cyl(0.45, 26, (x, 13, z), seg=10, r2=0.28)
    det.box((3.0, 1.8, 0.8), (x, 26.5, z))
for a in range(4):                                                   # lightning masts
    ang = a * math.pi / 2
    x, z = 34 * math.cos(ang), 34 * math.sin(ang)
    det.cyl(0.5, 78, (x, 39, z), seg=10, r2=0.16)
# cable trays / pipes running from tanks to pad
det.finish()

pipes = Batch("Pipes", M_STEELD)
pipes.box((2.0, 0.5, 0.5), (-30, 1.6, 14))
pipes.box((0.5, 0.5, 20), (-44, 1.6, 8))
pipes.box((2.0, 0.5, 0.5), (28, 1.6, 18))
pipes.box((0.5, 0.5, 16), (40, 1.6, 12))
pipes.finish()

lamp = Batch("Lamps", M_LAMP)
for a in range(4):
    ang = a * math.pi / 2 + math.pi / 4
    x, z = 30 * math.cos(ang), 30 * math.sin(ang)
    lamp.box((2.6, 1.4, 0.4), (x, 26.3, z))
lamp.finish()

yel = Batch("Markings", M_YELLOW)
for i in range(6):
    yel.box((DECK, 0.06, 0.8), (0, PAD_TOP + 0.03, -DECK / 2 + 3 + i * 8))
yel.box((0.8, 0.06, DECK), (-DECK / 2 + 3, PAD_TOP + 0.03, 0))
yel.finish()

# ---------------------------------------------------------------- export
scene = bpy.context.scene
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "launchpad.glb")
out = os.path.abspath(out)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True,
                          export_yup=True, use_selection=True, export_cameras=False,
                          export_lights=False)
tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
for o in bpy.data.objects:
    if o.type == 'MESH':
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        print("NODE", o.name, "loc", [round(v,1) for v in o.location],
              "y", round(min(v.y for v in bb),1), round(max(v.y for v in bb),1),
              "x", round(min(v.x for v in bb),1), round(max(v.x for v in bb),1),
              "z", round(min(v.z for v in bb),1), round(max(v.z for v in bb),1))
print("@@", json.dumps({"file": out, "objects": len(bpy.data.objects), "faces": tris,
                        "mb": round(os.path.getsize(out) / 1048576, 2)}))