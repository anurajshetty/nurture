/**
 * Pelvic-floor relaxation — tile icons, hand-built from mockup 29's SVGs
 * (24x24 viewBox, round stroke, no stock icons). No new visual language.
 */
import Svg, { Circle, G, Path } from 'react-native-svg';
import type { ExerciseId } from './exercises';

function TileIcon({
  stroke,
  children,
}: {
  stroke: string;
  children: React.ReactNode;
}) {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" accessible={false}>
      <G fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </G>
    </Svg>
  );
}

/** Connection breath: layered breath lines. */
function BreathIcon({ stroke }: { stroke: string }) {
  return (
    <TileIcon stroke={stroke}>
      <Path d="M3 8h9a3 3 0 1 0-3-3" />
      <Path d="M3 12h13a3 3 0 1 1-3 3" />
      <Path d="M3 16h6a2.5 2.5 0 1 1-2.5 2.5" />
    </TileIcon>
  );
}

/** Reverse Kegel: downward arrow over a ground line. */
function ReverseIcon({ stroke }: { stroke: string }) {
  return (
    <TileIcon stroke={stroke}>
      <Path d="M12 3v13" />
      <Path d="M7 11l5 5 5-5" />
      <Path d="M5 21h14" />
    </TileIcon>
  );
}

/** Visualizations: sun/flower opening. */
function VisualIcon({ stroke }: { stroke: string }) {
  return (
    <TileIcon stroke={stroke}>
      <Circle cx="12" cy="12" r="3.2" />
      <Path d="M12 2.5v3.4M12 18.1v3.4M2.5 12h3.4M18.1 12h3.4M5.3 5.3l2.4 2.4M16.3 16.3l2.4 2.4M18.7 5.3l-2.4 2.4M7.7 16.3l-2.4 2.4" />
    </TileIcon>
  );
}

/** Release positions: restful seated figure. */
function PositionsIcon({ stroke }: { stroke: string }) {
  return (
    <TileIcon stroke={stroke}>
      <Circle cx="13" cy="4.5" r="2.2" />
      <Path d="M5 20c1.5-3.5 4-5.5 8-5.5 2.5 0 4.5 1 6 3" />
      <Path d="M13 7.5c-1 2.5-1 5 0 7" />
    </TileIcon>
  );
}

export function ExerciseTileIcon({ id, stroke }: { id: ExerciseId; stroke: string }) {
  switch (id) {
    case 'breath':
      return <BreathIcon stroke={stroke} />;
    case 'reverse':
      return <ReverseIcon stroke={stroke} />;
    case 'visual':
      return <VisualIcon stroke={stroke} />;
    case 'positions':
      return <PositionsIcon stroke={stroke} />;
  }
}
