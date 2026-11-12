import { COURT_LINES, LANDMARKS, LANDMARK_LABELS, type Point } from '../math';

const W = 150;
const H = 250;
const PAD = 14;

function toSvg([x, y]: Point): Point {
  const sx = PAD + ((x + 6.4) / 12.8) * (W - 2 * PAD);
  const sy = PAD + ((11.885 - y) / 23.77) * (H - 2 * PAD);
  return [sx, sy];
}

interface Props {
  ids: string[];
  current: number;
  placed: number;
  compact?: boolean;
}

/** Reference diagram: where each landmark of the preset sits, and in which order. */
export function CourtDiagram({ ids, current, placed, compact = false }: Props) {
  const width = compact ? 118 : W;
  const height = compact ? 190 : H;
  return (
    <svg
      className="court-diagram"
      viewBox={`0 0 ${W} ${H}`}
      width={width}
      height={height}
      role="img"
      aria-label="Ordre des points du court à cliquer"
    >
      {COURT_LINES.map((line, index) => (
        <polyline
          key={index}
          points={line.map((p) => toSvg(p).join(',')).join(' ')}
          fill="none"
          stroke="rgba(255,214,0,0.55)"
          strokeWidth={1.4}
        />
      ))}
      {ids.map((id, index) => {
        const landmark = LANDMARKS[id];
        if (!landmark) return null;
        const [x, y] = toSvg(landmark);
        const done = index < placed;
        const active = index === current;
        return (
          <g key={id}>
            <circle
              cx={x}
              cy={y}
              r={active ? 9 : 7}
              fill={done ? '#2ea043' : active ? '#ffd166' : '#161b22'}
              stroke={active ? '#ffffff' : 'rgba(0,220,255,0.8)'}
              strokeWidth={active ? 2 : 1.3}
            />
            <text
              x={x}
              y={y + 3.2}
              textAnchor="middle"
              fontSize={8}
              fontWeight={600}
              fill={active ? '#0d1117' : done ? '#ffffff' : '#8b949e'}
            >
              {index + 1}
            </text>
            {active && <title>{`${index + 1}. ${LANDMARK_LABELS[id] ?? id}`}</title>}
          </g>
        );
      })}
    </svg>
  );
}
