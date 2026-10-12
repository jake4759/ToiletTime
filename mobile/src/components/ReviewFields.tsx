import { Fragment } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useTheme } from '../theme';
import { RATING_CATEGORIES, type ReviewDraft } from '../types';
import { Section, Separator, StarInput } from './ui';

export const isReviewComplete = (r: ReviewDraft) => RATING_CATEGORIES.every(([key]) => r[key] > 0);

export function ReviewFields({ value, onChange }: { value: ReviewDraft; onChange: (r: ReviewDraft) => void }) {
  const theme = useTheme();
  const set = <K extends keyof ReviewDraft>(key: K, v: ReviewDraft[K]) => onChange({ ...value, [key]: v });

  return (
    <>
      <Section title="Ratings" footer="Rate each category from 1 to 5 stars.">
        {RATING_CATEGORIES.map(([key, label], i) => (
          <Fragment key={key}>
            {i > 0 && <Separator />}
            <StarInput label={label} value={value[key]} onChange={(n) => set(key, n)} />
          </Fragment>
        ))}
      </Section>
      <Section title="Review" footer="Your review is posted with your account name.">
        <View style={styles.commentWrap}>
          <TextInput
            multiline
            placeholder="How was it? Cleanliness, wait, anything others should know."
            placeholderTextColor={theme.muted}
            value={value.comment}
            onChangeText={(t) => set('comment', t)}
            maxLength={1000}
            style={[styles.comment, { color: theme.text }]}
          />
        </View>
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  commentWrap: { paddingHorizontal: 16, paddingVertical: 10 },
  comment: { fontSize: 17, minHeight: 96, textAlignVertical: 'top' },
});
