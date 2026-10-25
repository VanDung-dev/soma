import { Fragment, useId } from "react";
import type { HandFeedback } from "./viewer/hand-camera";

const fingers = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const palm = [0, 1, 2, 5, 9, 13, 17];

function VirtualHand({ hand, aspect }: { hand: HandFeedback["hands"][number]; aspect: number }) {
  const points = hand.landmarks.map(([x, y]) => [x * aspect * 1000, y * 1000] as const);
  const palmSize = Math.hypot(points[0]![0] - points[9]![0], points[0]![1] - points[9]![1]);
  const path = (indices: number[]) => indices.map(index => points[index]!.join(",")).join(" ");
  return <g className="hand-virtual" data-side={hand.side} data-pinching={hand.pinching} data-state={hand.state}>
    <g className="hand-virtual-surface">
      <polygon points={path(palm)} strokeWidth={palmSize * 0.2} />
      {fingers.flatMap((finger, digit) => finger.slice(1).map((end, joint) => {
        const start = points[finger[joint]!]!, finish = points[end]!;
        return <line key={`${digit}-${joint}`} x1={start[0]} y1={start[1]} x2={finish[0]} y2={finish[1]}
          strokeWidth={palmSize * (0.27 - joint * 0.045) * (digit === 4 ? 0.8 : 1)} />;
      }))}
    </g>
  </g>;
}

function MouseIndicator({ button, pressed }: { button: "left" | "right"; pressed: boolean }) {
  return <svg viewBox="0 0 32 40" width="24" height="30" fill="none" aria-hidden="true" data-mouse-button={button}>
    <path className={pressed ? "hand-mouse-pressed" : "hand-mouse-mapped"}
      d={button === "left" ? "M15 4a10 10 0 0 0-10 10v3h10Z" : "M17 4a10 10 0 0 1 10 10v3H17Z"} />
    <rect x="4" y="3" width="24" height="34" rx="12" stroke="currentColor" strokeWidth="2" />
    <path d="M16 4v13M5 18h22" stroke="currentColor" strokeWidth="1.5" />
    <path d="M16 8v5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>;
}

export function HandInteractionOverlay({ feedback, aspect = 4 / 3, interactive = true }: { feedback: HandFeedback; aspect?: number; interactive?: boolean }) {
  const maskId = useId();
  if (!feedback.hands.length) return null;
  interactive = interactive && feedback.mode !== "paused";
  const pinched = feedback.hands.filter(hand => hand.state === "active");
  const pair = interactive && feedback.mode === "zoom" && pinched.length === 2 ? pinched : null;
  const rectangles = Array.from({ length: feedback.region.length / 4 }, (_, index) => {
    const [left, top, right, bottom] = feedback.region.slice(index * 4, index * 4 + 4) as [number, number, number, number];
    return { x: left * 1000, y: top * 1000, width: (right - left) * 1000, height: (bottom - top) * 1000 };
  });
  return <div className="hand-interaction-overlay" aria-hidden="true" data-mode={feedback.mode} data-zoom={feedback.zoom}>
    {interactive && rectangles.length > 0 && <svg className="hand-start-region" viewBox="0 0 1000 1000" preserveAspectRatio="none">
      <defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">
        {rectangles.map((rect, index) => <rect key={index} {...rect} fill={index === 0 ? "white" : "black"} />)}
      </mask></defs>
      <rect {...rectangles[0]} mask={`url(#${maskId})`} />
    </svg>}
    <svg className="hand-virtual-layer" viewBox={`0 0 ${aspect * 1000} 1000`} preserveAspectRatio="none">
      {feedback.hands.map(hand => <VirtualHand key={hand.side} hand={hand} aspect={aspect} />)}
    </svg>
    {pair && <svg className="hand-interaction-link" width="100%" height="100%">
      <line x1={`${pair[0]!.x * 100}%`} y1={`${pair[0]!.y * 100}%`}
        x2={`${pair[1]!.x * 100}%`} y2={`${pair[1]!.y * 100}%`} />
    </svg>}
    {feedback.hands.map(hand => {
      const mappedButton = hand.side === "right" ? "left" : "right";
      const paused = feedback.mode === "paused" || !interactive;
      const active = !paused && hand.state === "active";
      const zooming = active && feedback.mode === "zoom";
      const button = active && !zooming ? mappedButton : "none";
      const state = paused ? "release" : hand.state;
      const center = [0, 5, 9, 13, 17].reduce<[number, number]>(([x, y], index) => {
        const point = hand.landmarks[index]!;
        return [x + point[0] / 5, y + point[1] / 5];
      }, [0, 0]);
      return <Fragment key={hand.side}>
        <span className="hand-pinch-point" data-side={hand.side} data-state={state}
          style={{ left: `${hand.x * 100}%`, top: `${hand.y * 100}%` }} />
        <div className="hand-cursor" data-side={hand.side} data-button={button} data-mouse-button={mappedButton}
          data-state={state}
          style={{ left: `${center[0] * 100}%`, top: `${center[1] * 100}%` }}>
          <span className="hand-cursor-ring"><MouseIndicator button={mappedButton} pressed={button !== "none"} /></span>
        </div>
      </Fragment>;
    })}
    {pair && feedback.zoom !== "none" && <div className="hand-zoom-indicator"
      style={{ left: `${(pair[0]!.x + pair[1]!.x) * 50}%`, top: `${(pair[0]!.y + pair[1]!.y) * 50}%` }}>
      <span className="hand-zoom-symbol">{feedback.zoom === "in" ? "+" : "−"}</span>
    </div>}
  </div>;
}
