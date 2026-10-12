import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';

import { DEFAULT_CHARACTER, drawCharacter, VIEW_HEIGHT, VIEW_WIDTH, VIEWBOX, type CharacterConfig, type Shape } from './draw';

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
    <Svg width={(height * VIEW_WIDTH) / VIEW_HEIGHT} height={height} viewBox={VIEWBOX}>
      {drawCharacter(character).map(render)}
    </Svg>
  );
});

/** The character standing in a round badge in their background color, as on the map. */
export const CharacterBadge = memo(function CharacterBadge({
  character,
  size,
  border = 3,
}: {
  character: Partial<CharacterConfig> | null | undefined;
  size: number;
  border?: number;
}) {
  return (
    <View
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: border,
          backgroundColor: character?.bgColor ?? DEFAULT_CHARACTER.bgColor,
        },
      ]}
    >
      <Character character={character} height={size * 0.88} />
    </View>
  );
});

const styles = StyleSheet.create({
  badge: { borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
