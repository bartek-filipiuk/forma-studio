import {
  Component,
  memo,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  GizmoHelper,
  GizmoViewport,
  OrbitControls,
  TransformControls,
} from "@react-three/drei";
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
  Sphere,
  Texture,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { dimensions, resolvedParams, signature } from "../domain";
import type { Part, Project } from "../domain";
import { useStudio } from "../store";
import SceneLabel from "./SceneLabel";

export interface ExactMesh {
  vertices: number[][];
  triangles: number[][];
  volume_mm3: number;
  bounds_mm: number[];
  valid: boolean;
}
export interface Verified {
  partId: string;
  signature: string;
  mesh: ExactMesh;
}
function outline(w: number, h: number, r: number) {
  const s = new Shape();
  r = Math.max(0, Math.min(r, Math.min(w, h) / 2 - 0.001));
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}
function extrude(shape: Shape, depth: number, z = 0) {
  return new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 12,
  }).translate(0, 0, z);
}
function hole(s: Shape, w: number, h: number, r: number) {
  s.holes.push(outline(w, h, r));
  return s;
}
function circleHole(s: Shape, x: number, y: number, r: number) {
  const p = new Path();
  p.absarc(x, y, r, 0, Math.PI * 2, true);
  s.holes.push(p);
}
function makeGeometry(part: Part, p: Record<string, number>): BufferGeometry {
  if (part.template === "cylinder") {
    const s = new Shape();
    s.absarc(0, 0, p.diameter / 2, 0, Math.PI * 2, false);
    if (p.holeDiameter > 0) circleHole(s, 0, 0, p.holeDiameter / 2);
    return extrude(s, p.height);
  }
  const w = p.width,
    d = p.depth,
    h = p.height,
    r = p.radius ?? 1;
  if (part.template === "enclosure") {
    const bottom = extrude(outline(w, d, r), p.wall);
    const ring = extrude(
      hole(
        outline(w, d, r),
        w - 2 * p.wall,
        d - 2 * p.wall,
        Math.max(r - p.wall, 0),
      ),
      h - p.wall,
      p.wall,
    );
    const merged = mergeGeometries([bottom, ring])!;
    bottom.dispose();
    ring.dispose();
    return merged;
  }
  if (part.template === "head") {
    const frame = extrude(
      hole(
        outline(w, h, r),
        p.windowWidth,
        p.windowHeight,
        Math.min(4, p.windowWidth / 4, p.windowHeight / 4),
      ),
      p.wall,
    );
    const ring = extrude(
      hole(
        outline(w, h, r),
        w - 2 * p.wall,
        h - 2 * p.wall,
        Math.max(r - p.wall, 0),
      ),
      d - p.wall,
      p.wall,
    );
    const merged = mergeGeometries([frame, ring])!;
    frame.dispose();
    ring.dispose();
    return merged
      .translate(0, 0, -d / 2)
      .rotateX(-Math.PI / 2)
      .translate(0, 0, h / 2);
  }
  const s = outline(w, d, r);
  if (part.template === "plate" && p.holeDiameter > 0) {
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        circleHole(
          s,
          x * (w / 2 - p.holeInset),
          y * (d / 2 - p.holeInset),
          p.holeDiameter / 2,
        );
  }
  return extrude(s, h);
}
function fromExact(data: ExactMesh) {
  const g = new BufferGeometry();
  g.setAttribute(
    "position",
    new Float32BufferAttribute(data.vertices.flat(), 3),
  );
  g.setIndex(data.triangles.flat());
  g.computeVertexNormals();
  return g;
}

function disposeImported(object: Group | Mesh) {
  object.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) {
          value.dispose();
          // GLTFLoader may use ImageBitmap, which needs explicit CPU cleanup.
          if (typeof ImageBitmap !== "undefined" && value.image instanceof ImageBitmap)
            value.image.close();
        }
      }
      material.dispose();
    }
  });
}
function Imported({ part }: { part: Part }) {
  const invalidate = useThree((state) => state.invalidate);
  const [object, setObject] = useState<Group | Mesh | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setObject(null);
    setError(false);
    let loaded: Group | Mesh | null = null;
    async function load() {
      try {
        const info = await fetch(`/api/assets/${part.asset_id}`, {
          signal: controller.signal,
        });
        if (!info.ok) throw new Error("file");
        const meta = await info.json();
        const response = await fetch(meta.url, { signal: controller.signal });
        if (!response.ok) throw new Error("file");
        const data = await response.arrayBuffer();
        if (meta.mime === "model/gltf-binary") {
          const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
          const gltf = await new GLTFLoader().parseAsync(data, "");
          loaded = gltf.scene;
          loaded.scale.setScalar(meta.metadata?.units === "mm" ? 1 : 1000);
        } else {
          const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
          const geometry = new STLLoader().parse(data);
          loaded = new Mesh(
            geometry,
            new MeshStandardMaterial({ roughness: 0.72 }),
          );
        }
        loaded.updateMatrixWorld(true);
        const b = new Box3().setFromObject(loaded);
        const c = b.getCenter(new Vector3());
        loaded.position.sub(new Vector3(c.x, c.y, b.min.z));
        loaded.traverse((n) => {
          if (n instanceof Mesh) {
            n.castShadow = true;
            n.receiveShadow = true;
          }
        });
        if (controller.signal.aborted) disposeImported(loaded);
        else setObject(loaded);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(true);
      }
    }
    void load();
    return () => {
      controller.abort();
      if (loaded) disposeImported(loaded);
    };
  }, [part.asset_id]);
  useEffect(() => {
    // Recolor STL locally; preserve GLB's original materials and textures.
    if (object instanceof Mesh && object.material instanceof MeshStandardMaterial)
      object.material.color.set(part.color);
    invalidate();
  }, [object, part.color, invalidate]);
  return (
    <group>
      {error ? (
        <SceneLabel className="mesh-error" text={"Plik niedostępny\nZaimportuj go ponownie"} />
      ) : !object ? (
        <SceneLabel className="mesh-loading" text="Wczytywanie siatki…" />
      ) : null}
      {object && <primitive object={object} />}
    </group>
  );
}
function Body({
  part,
  params,
  exact,
  selected,
  xray,
}: {
  part: Part;
  params: Record<string, number>;
  exact?: ExactMesh;
  selected: boolean;
  xray: boolean;
}) {
  const geometry = useMemo(
    () => (exact ? fromExact(exact) : makeGeometry(part, params)),
    [part.template, JSON.stringify(params), exact],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const [w, d, h] = dimensions(part, params);
  return (
    <>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          color={part.color}
          roughness={0.7}
          metalness={0.05}
          transparent={xray && part.role === "print"}
          opacity={xray && part.role === "print" ? 0.25 : 1}
          depthWrite={!(xray && part.role === "print")}
          side={DoubleSide}
          emissive={selected ? "#566935" : "#000000"}
          emissiveIntensity={selected ? 0.09 : 0}
        />
      </mesh>
      {part.template === "cores3" && (
        <>
          <mesh
            position={[0, -d / 2 - 0.4, h / 2]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[w - 5, h - 5]} />
            <meshStandardMaterial color="#182528" roughness={0.4} />
          </mesh>
          {[-1, 1].map((sign) => (
            <mesh
              key={sign}
              position={[sign * 11, -d / 2 - 0.9, h * 0.59]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <capsuleGeometry args={[3.7, 7, 4, 12]} />
              <meshStandardMaterial
                color="#d8f1a1"
                emissive="#b5de72"
                emissiveIntensity={0.6}
              />
            </mesh>
          ))}
          <mesh
            position={[0, -d / 2 - 1, h * 0.3]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <boxGeometry args={[12, 2, 1]} />
            <meshStandardMaterial color="#d8f1a1" />
          </mesh>
        </>
      )}
      {part.template === "pca9685" && (
        <>
          <mesh position={[0, 0, h / 2 + 2]}>
            <boxGeometry args={[w - 6, d - 6, h - 4]} />
            <meshStandardMaterial color="#18372d" />
          </mesh>
          {[-1, 1].map((sign) => (
            <mesh key={sign} position={[sign * (w / 2 - 6), 0, h + 1]}>
              <boxGeometry args={[5, d - 8, 3]} />
              <meshStandardMaterial
                color="#c3a778"
                metalness={0.55}
                roughness={0.3}
              />
            </mesh>
          ))}
        </>
      )}
      {part.template === "sg90" && (
        <mesh position={[w * 0.2, 0, h + 2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[3, 3, 4, 16]} />
          <meshStandardMaterial color="#e9e7dc" />
        </mesh>
      )}
    </>
  );
}
function Selection({
  part,
  params,
}: {
  part: Part;
  params: Record<string, number>;
}) {
  const [w, d, h] = dimensions(part, params);
  const show = useStudio((s) => s.showDimensions);
  const points = useMemo(() => {
    const a = w / 2 + 1,
      b = d / 2 + 1,
      z = h + 1;
    return new Float32Array([
      -a,
      -b,
      0,
      a,
      -b,
      0,
      a,
      -b,
      0,
      a,
      b,
      0,
      a,
      b,
      0,
      -a,
      b,
      0,
      -a,
      b,
      0,
      -a,
      -b,
      0,
      -a,
      -b,
      z,
      a,
      -b,
      z,
      a,
      -b,
      z,
      a,
      b,
      z,
      a,
      b,
      z,
      -a,
      b,
      z,
      -a,
      b,
      z,
      -a,
      -b,
      z,
      -a,
      -b,
      0,
      -a,
      -b,
      z,
      a,
      -b,
      0,
      a,
      -b,
      z,
      a,
      b,
      0,
      a,
      b,
      z,
      -a,
      b,
      0,
      -a,
      b,
      z,
    ]);
  }, [w, d, h]);
  return (
    <>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[points, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#7b8d55" transparent opacity={0.65} />
      </lineSegments>
      {show && (
        <SceneLabel
          position={[0, -d / 2 - 12, 0]}
          className="dimension"
          text={`${(w * part.transform.scale).toFixed(1)} mm`}
        />
      )}
    </>
  );
}
function InteractivePart({
  part,
  project,
  verified,
  index,
}: {
  part: Part;
  project: Project;
  verified: Verified | null;
  index: number;
}) {
  const ref = useRef<Group>(null);
  const selected = useStudio((s) => s.selectedId === part.id),
    tool = useStudio((s) => s.tool),
    xray = useStudio((s) => s.xray),
    explode = useStudio((s) => s.explode),
    pan = useStudio((s) => s.pan),
    tilt = useStudio((s) => s.tilt);
  const params = resolvedParams(project, part),
    r = part.transform.rotation.map((x) => (x * Math.PI) / 180);
  const exact =
    verified?.partId === part.id &&
    verified.signature === signature(project, part)
      ? verified.mesh
      : undefined;
  const position = [...part.transform.position] as [number, number, number];
  position[2] += explode * index * 20;
  const content = (
    <>
      <group
        ref={ref}
        position={position}
        rotation={[r[0], r[1], r[2], "ZYX"]}
        scale={part.transform.scale}
        onPointerDown={(e) => {
          e.stopPropagation();
          useStudio.getState().select(part.id);
        }}
      >
        {part.template === "mesh" ? (
          <Imported part={part} />
        ) : (
          <Body
            part={part}
            params={params}
            exact={exact}
            selected={selected}
            xray={xray}
          />
        )}
        {selected && part.template !== "mesh" && (
          <Selection part={part} params={params} />
        )}
      </group>
      {selected &&
        tool !== "select" &&
        explode === 0 &&
        pan === 0 &&
        tilt === 0 && (
          <TransformControls
            object={ref as React.RefObject<Group>}
            mode={tool}
            space="world"
            translationSnap={1}
            rotationSnap={(Math.PI / 180) * 5}
            size={0.7}
            onMouseUp={() => {
              if (!ref.current) return;
              const obj = ref.current;
              const rotation = obj.rotation;
              const ok = useStudio
                .getState()
                .update(part.id, {
                  transform: {
                    position: obj.position
                      .toArray()
                      .map((x) => Math.round(x * 10) / 10),
                    rotation: [rotation.x, rotation.y, rotation.z].map(
                      (x) => Math.round(((x * 180) / Math.PI) * 10) / 10,
                    ),
                  },
                });
              if (!ok) {
                obj.position.set(...part.transform.position);
                obj.rotation.set(r[0], r[1], r[2], "ZYX");
              }
            }}
          />
        )}
    </>
  );
  if (part.group === "head")
    return (
      <group position={[0, 0, 79]} rotation={[0, 0, (pan * Math.PI) / 180]}>
        <group rotation={[(tilt * Math.PI) / 180, 0, 0]}>
          <group position={[0, 0, -79]}>{content}</group>
        </group>
      </group>
    );
  if (part.group === "neck")
    return <group rotation={[0, 0, (pan * Math.PI) / 180]}>{content}</group>;
  return content;
}
function World({ verified }: { verified: Verified | null }) {
  const project = useStudio((s) => s.project),
    showRefs = useStudio((s) => s.showRefs),
    frameTick = useStudio((s) => s.frameTick);
  const { camera } = useThree();
  const controls = useRef<OrbitControlsImpl>(null),
    assembly = useRef<Group>(null);
  useEffect(() => {
    camera.up.set(0, 0, 1);
  }, [camera]);
  useEffect(() => {
    if (!controls.current || !assembly.current) return;
    const b = new Box3().setFromObject(assembly.current);
    if (b.isEmpty()) return;
    const sphere = b.getBoundingSphere(new Sphere());
    const radius = Math.max(40, Math.min(sphere.radius, 1500));
    camera.position.copy(
      sphere.center
        .clone()
        .add(
          new Vector3(1, -1.7, 0.95).normalize().multiplyScalar(radius * 3.25),
        ),
    );
    controls.current.target.copy(sphere.center);
    controls.current.update();
  }, [frameTick, camera]);
  return (
    <>
      <color attach="background" args={["#e7ebe5"]} />
      <ambientLight intensity={1.25} />
      <hemisphereLight args={["#ffffff", "#a9b0a3", 1.7]} />
      <directionalLight
        position={[-140, -170, 330]}
        intensity={3}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-260}
        shadow-camera-right={260}
        shadow-camera-top={260}
        shadow-camera-bottom={-260}
        shadow-camera-near={1}
        shadow-camera-far={700}
        shadow-bias={-0.0001}
      />
      <directionalLight position={[100, 160, 180]} intensity={1.1} />
      <mesh rotation={[0, 0, 0]} position={[0, 0, -0.8]} receiveShadow>
        <planeGeometry args={[3000, 3000]} />
        <meshStandardMaterial color="#e2e7de" roughness={1} />
      </mesh>
      <gridHelper
        args={[600, 60, "#b2bbb0", "#c9d1c5"]}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, -0.65]}
      />
      <group ref={assembly}>
        {project.parts
          .filter((p) => p.visible && (showRefs || p.role === "print"))
          .map((p, i) => (
            <InteractivePart
              key={p.id}
              part={p}
              project={project}
              verified={verified}
              index={i}
            />
          ))}
      </group>
      <OrbitControls
        ref={controls}
        makeDefault
        target={[0, 0, 75]}
        minDistance={10}
        maxDistance={3000}
        maxPolarAngle={Math.PI * 0.49}
        enableDamping
        dampingFactor={0.12}
      />
      <GizmoHelper alignment="bottom-right" margin={[56, 66]}>
        <GizmoViewport
          axisColors={["#ca7f6c", "#799771", "#6e94b3"]}
          labelColor="#ffffff"
          hideNegativeAxes
        />
      </GizmoHelper>
    </>
  );
}
class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="scene-failure">
        Nie udało się uruchomić widoku 3D.
        <br />
        Włącz akcelerację sprzętową przeglądarki i odśwież stronę.
      </div>
    ) : (
      this.props.children
    );
  }
}
function Scene({ verified }: { verified: Verified | null }) {
  return (
    <SceneBoundary>
      <Canvas
        frameloop="demand"
        shadows
        dpr={[1, 1.75]}
        camera={{
          position: [240, -340, 240],
          up: [0, 0, 1],
          near: 0.1,
          far: 10000,
          fov: 38,
        }}
        onPointerMissed={() => useStudio.getState().select(null)}
        gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          <World verified={verified} />
        </Suspense>
      </Canvas>
    </SceneBoundary>
  );
}

export default memo(Scene);
