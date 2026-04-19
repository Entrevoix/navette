import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

interface DiffViewProps {
  content: string;
}

export function DiffView({ content }: DiffViewProps) {
  const [expanded, setExpanded] = useState(false);

  // Only render if looks like a diff
  if (!content.includes('\n+') && !content.includes('\n-') && !content.includes('@@')) {
    return null;
  }

  const lines = content.split('\n');
  const hasDiff = lines.some(l => l.startsWith('+') || l.startsWith('-') || l.startsWith('@@'));
  if (!hasDiff) return null;

  const added = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
  const removed = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;

  return (
    <View style={styles.container}>
      <Pressable style={styles.header} onPress={() => setExpanded(x => !x)}>
        <Text style={styles.headerText}>
          Diff {expanded ? '▼' : '▶'}
        </Text>
        <View style={styles.stats}>
          {added > 0 && <Text style={styles.added}>+{added}</Text>}
          {removed > 0 && <Text style={styles.removed}>-{removed}</Text>}
        </View>
      </Pressable>
      {expanded && (
        <ScrollView style={styles.body} horizontal>
          <View>
            {lines.map((line, i) => {
              const isAdded = line.startsWith('+') && !line.startsWith('+++');
              const isRemoved = line.startsWith('-') && !line.startsWith('---');
              const isHunk = line.startsWith('@@');
              return (
                <Text
                  key={i}
                  style={[
                    styles.line,
                    isAdded && styles.lineAdded,
                    isRemoved && styles.lineRemoved,
                    isHunk && styles.lineHunk,
                  ]}
                  numberOfLines={1}
                >
                  {line || ' '}
                </Text>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 6, borderRadius: 6, borderWidth: 1, borderColor: '#2a2a2a', overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#111' },
  headerText: { color: '#6b7280', fontSize: 11, fontWeight: '600' },
  stats: { flexDirection: 'row', gap: 8 },
  added: { color: '#4ade80', fontSize: 11, fontWeight: '700' },
  removed: { color: '#f87171', fontSize: 11, fontWeight: '700' },
  body: { maxHeight: 240, backgroundColor: '#0a0a0a' },
  line: { fontFamily: 'Menlo', fontSize: 11, paddingHorizontal: 10, paddingVertical: 1, color: '#a1a1aa' },
  lineAdded: { backgroundColor: '#0a2a0a', color: '#4ade80' },
  lineRemoved: { backgroundColor: '#2a0a0a', color: '#f87171' },
  lineHunk: { color: '#60a5fa', backgroundColor: '#0a0f1a' },
});
