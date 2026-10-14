import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Group, Vector3 } from "three";

// These labels are plain text. Keeping their DOM outside nested React roots
// avoids Html's concurrent-root teardown race during selection/import changes.
export default function SceneLabel({
  text,
  className,
  position = [0, 0, 0],
}: {
  text: string;
  className: string;
  position?: [number, number, number];
}) {
  const group = useRef<Group>(null);
  const element = useRef<HTMLDivElement | null>(null);
  const projected = useRef(new Vector3());
  const { gl, invalidate } = useThree();
  useEffect(() => {
    const label = document.createElement("div");
    label.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;visibility:hidden;white-space:pre-line";
    const content = document.createElement("span");
    content.style.cssText = "display:block;transform:translate(-50%,-50%)";
    label.appendChild(content);
    gl.domElement.parentElement?.appendChild(label);
    element.current = label;
    return () => {
      label.remove();
      element.current = null;
    };
  }, [gl]);
  useEffect(() => {
    if (!element.current) return;
    element.current.className = className === "dimension" ? className : "";
    const content = element.current.firstElementChild as HTMLSpanElement;
    content.className = className === "dimension" ? "" : className;
    content.textContent = text;
    invalidate();
  }, [text, className, invalidate]);
  useFrame(({ camera, size }) => {
    if (!group.current || !element.current) return;
    const point = group.current.getWorldPosition(projected.current).project(camera);
    element.current.style.visibility = point.z >= -1 && point.z <= 1 ? "visible" : "hidden";
    element.current.style.transform = `translate(${(point.x + 1) * size.width / 2}px,${(1 - point.y) * size.height / 2}px)`;
  });
  return <group ref={group} position={position} />;
}
