import { memo, type ReactNode } from 'react';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';

import { drawCharacter, VIEWBOX, type CharacterConfig, type Shape } from './draw';

const COMPONENTS: Record<Shape['t'], any> = {
  circle: Circle,
  ellipse: Ellipse,
  rect: Rect,
  path: Path,
  polygon: Polygon,
  line: Line,
  g: G,
  defs: Defs,
  linearGradient: LinearGradient,
  stop: Stop,
};

function render(shape: Shape, key: number): ReactNode {
  const Component = COMPONENTS[shape.t];
  return (
    <Component key={key} {...shape.p}>
      {shape.c?.map(render)}
    </Component>
  );
}

/** Draws a Flush Buddy. `height` sets the size; the width follows the drawing's proportions. */
export const Character = memo(function Character({
  character,
  height,
}: {
  character: Partial<CharacterConfig> | null | undefined;
  height: number;
}) {
  return (
    <Svg width={(height * 120) / 182} height={height} viewBox={VIEWBOX}>
      {drawCharacter(character).map(render)}
    </Svg>
  );
});
