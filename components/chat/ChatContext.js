import React from 'react';

export const ChatContext = React.createContext(null);

export function useChat() {
  const value = React.useContext(ChatContext);
  if (!value) throw new Error('useChat must be used inside ChatDataProvider.');
  return value;
}
