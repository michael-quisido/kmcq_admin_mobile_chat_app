let pendingConversationId: number | null = null;

export function setPendingConversationId(id: number): void {
  if (Number.isInteger(id) && id > 0) {
    pendingConversationId = id;
  }
}

export function consumePendingConversationId(): number | null {
  const id = pendingConversationId;
  pendingConversationId = null;
  return id;
}
