import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApprovalCard } from '../components/ApprovalCard';
import { EventFeed } from '../components/EventFeed';
import { ConnectionStatus, EventFrame, PendingApproval } from '../types';

interface MainScreenProps {
  status: ConnectionStatus;
  events: EventFrame[];
  pendingApprovals: PendingApproval[];
  lastSeq: number;
  onDecide: (tool_use_id: string, allow: boolean) => void;
  onDisconnect: () => void;
}

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  disconnected: '#6b7280',
  connecting: '#fbbf24',
  authenticating: '#fbbf24',
  connected: '#4ade80',
  error: '#f87171',
};

export function MainScreen({ status, events, pendingApprovals, lastSeq, onDecide, onDisconnect }: MainScreenProps) {
  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: STATUS_COLOR[status] }]} />
          <Text style={styles.statusText}>{status}</Text>
          {lastSeq > 0 && <Text style={styles.seqBadge}>seq {lastSeq}</Text>}
        </View>
        <Pressable onPress={onDisconnect} style={styles.disconnectBtn}>
          <Text style={styles.disconnectText}>Disconnect</Text>
        </Pressable>
      </View>

      {pendingApprovals.length > 0 && (
        <View style={styles.approvalsSection}>
          <Text style={styles.sectionLabel}>
            {pendingApprovals.length} pending approval{pendingApprovals.length !== 1 ? 's' : ''}
          </Text>
          <ScrollView
            horizontal={false}
            showsVerticalScrollIndicator={false}
            style={styles.approvalsList}
          >
            {pendingApprovals.map((approval: PendingApproval) => (
              <ApprovalCard
                key={approval.tool_use_id}
                approval={approval}
                onDecide={onDecide}
              />
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.feedSection}>
        <Text style={styles.sectionLabel}>Event stream</Text>
        <EventFeed events={events} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '500',
  },
  seqBadge: {
    color: '#444',
    fontSize: 11,
    marginLeft: 4,
  },
  disconnectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  disconnectText: {
    color: '#666',
    fontSize: 13,
  },
  approvalsSection: {
    maxHeight: '55%',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    paddingTop: 12,
  },
  approvalsList: {
    flexGrow: 0,
  },
  sectionLabel: {
    color: '#555',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  feedSection: {
    flex: 1,
    paddingTop: 12,
  },
});
