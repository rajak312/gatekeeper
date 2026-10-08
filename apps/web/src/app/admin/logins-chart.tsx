'use client';

import { useState } from 'react';

interface Point {
  date: string;
  success: number;
  failure: number;
}

const W = 640;
const H = 250;
const PAD = { top: 12, right: 8, bottom: 26, left: 32 };

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

/**
 * Stacked bars: successful vs failed sign-ins per day. Colors come from CSS
 * variables validated for both themes; a legend plus a hover tooltip and a
 * screen-reader table carry the data, so identity is never color-only.
 */
export function LoginsChart({ data }: { data: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...data.map((d) => d.success + d.failure)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / data.length;
  const barW = Math.min(28, band * 0.62);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const active = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <div className="mb-3 flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: 'var(--chart-success)' }} /> Successful
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: 'var(--chart-failure)' }} /> Failed
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Sign-ins per day over the last 14 days"
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--chart-grid)"
              strokeDasharray={t === 0 ? undefined : '3 3'}
            />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--subtle)] text-[10px]">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.left + band * i + band / 2;
          const x = cx - barW / 2;
          const sTop = y(d.success);
          const fTop = y(d.success + d.failure);
          const gap = d.failure > 0 && d.success > 0 ? 2 : 0;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              <rect
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={innerH}
                fill={hover === i ? 'var(--chart-grid)' : 'transparent'}
                opacity={0.5}
              />
              {d.success > 0 ? (
                <path d={roundedTop(x, sTop, barW, y(0) - sTop, d.failure > 0 ? 0 : 4)} fill="var(--chart-success)" />
              ) : null}
              {d.failure > 0 ? (
                <path d={roundedTop(x, fTop, barW, sTop - fTop - gap, 4)} fill="var(--chart-failure)" />
              ) : null}
              {i % 2 === 0 || data.length <= 7 ? (
                <text x={cx} y={H - 8} textAnchor="middle" className="fill-[var(--subtle)] text-[10px]">
                  {fmt(d.date)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {active && hover !== null ? (
        <div
          className="pointer-events-none absolute top-8 z-10 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg"
          style={{
            left: `clamp(0px, calc(${((PAD.left + band * hover + band / 2) / W) * 100}% - 64px), calc(100% - 128px))`,
          }}
        >
          <p className="font-medium text-fg">{fmt(active.date)}</p>
          <p className="mt-1 flex justify-between gap-4 text-muted">
            Successful <span className="font-mono text-fg">{active.success}</span>
          </p>
          <p className="flex justify-between gap-4 text-muted">
            Failed <span className="font-mono text-fg">{active.failure}</span>
          </p>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>Sign-ins per day</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Successful</th>
            <th>Failed</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.success}</td>
              <td>{d.failure}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}
