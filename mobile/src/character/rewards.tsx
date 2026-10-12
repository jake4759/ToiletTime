import * as Haptics from 'expo-haptics';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '../auth';
import { plural } from '../theme';
import type { Rewards } from '../types';
import { ClosetSheet } from './ClosetSheet';

/**
 * Celebrates what a new review earned. Returns `celebrate(rewards)` and a Closet sheet
 * to render in the current screen, so "Open Closet" works from inside other sheets.
 */
export function useRewards() {
  const { refreshUser } = useAuth();
  const [closetOpen, setClosetOpen] = useState(false);

  const celebrate = useCallback(
    (rewards: Rewards | undefined) => {
      refreshUser().catch(() => {});
      if (!rewards) return;
      const next = rewards.nextUnlock;
      const goal = next
        ? `Review ${plural(next.at - rewards.reviewCount, 'more restroom')} to unlock ${next.items[0].name}.`
        : '';
      if (!rewards.newItems.length && !rewards.levelUp && !rewards.firstReview) return;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const items = rewards.newItems.map((i) => i.name);
      const lines = [
        rewards.firstReview ? 'You’re the first person to review this restroom. Trailblazer! 🚩' : null,
        rewards.levelUp ? `You're now a ${rewards.level.name}!` : null,
        items.length ? `New in your closet: ${items.join(', ')}.` : null,
        goal || null,
      ].filter(Boolean);
      const title = items.length ? 'You unlocked something! 🎉' : rewards.levelUp ? 'Level up! 🎉' : 'First review! 🚩';
      Alert.alert(title, lines.join('\n\n'), [
        { text: 'Later', style: 'cancel' },
        ...(items.length ? [{ text: 'Open Closet', onPress: () => setClosetOpen(true) }] : []),
      ]);
    },
    [refreshUser],
  );

  const closet = <ClosetSheet visible={closetOpen} onClose={() => setClosetOpen(false)} />;
  return { celebrate, closet };
}
