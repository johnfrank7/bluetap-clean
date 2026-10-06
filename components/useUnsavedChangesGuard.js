import React from 'react';
import { BackHandler, Platform } from 'react-native';
import UnsavedChangesModal from './UnsavedChangesModal';

export default function useUnsavedChangesGuard({
  isDirty = false,
  isSubmitting = false,
  onDiscard,
  onContinueEditing,
  firstIncompleteRef,
} = {}) {
  const [showPrompt, setShowPrompt] = React.useState(false);
  const pendingActionRef = React.useRef(null);
  const isDirtyRef = React.useRef(isDirty);
  const isSubmittingRef = React.useRef(isSubmitting);

  isDirtyRef.current = isDirty;
  isSubmittingRef.current = isSubmitting;

  // Web beforeunload protection (browser tab close / refresh)
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;

    const handleBeforeUnload = (event) => {
      if (isDirtyRef.current && !isSubmittingRef.current) {
        event.preventDefault();
        event.returnValue = '';
        return '';
      }
      return undefined;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Web browser Back button protection
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;

    const handlePopState = () => {
      if (isDirtyRef.current && !isSubmittingRef.current) {
        window.history.pushState(null, '', window.location.href);
        pendingActionRef.current = () => {
          isDirtyRef.current = false;
          window.history.back();
        };
        setShowPrompt(true);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Hardware Back button protection on native (Android)
  React.useEffect(() => {
    if (Platform.OS === 'web') return undefined;

    const handleBackPress = () => {
      if (isDirtyRef.current && !isSubmittingRef.current) {
        setShowPrompt(true);
        return true; // prevent default back
      }
      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    return () => subscription.remove();
  }, []);

  const confirmLeave = React.useCallback((proceedAction) => {
    if (!isDirtyRef.current || isSubmittingRef.current) {
      if (typeof proceedAction === 'function') proceedAction();
      return true;
    }
    pendingActionRef.current = proceedAction;
    setShowPrompt(true);
    return false;
  }, []);

  const handleContinueEditing = React.useCallback(() => {
    setShowPrompt(false);
    pendingActionRef.current = null;
    if (typeof onContinueEditing === 'function') {
      try {
        onContinueEditing();
      } catch {}
    }
    if (firstIncompleteRef?.current) {
      if (typeof firstIncompleteRef.current.focus === 'function') {
        firstIncompleteRef.current.focus();
      } else if (typeof firstIncompleteRef.current.scrollIntoView === 'function') {
        firstIncompleteRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [firstIncompleteRef, onContinueEditing]);

  const handleDiscardAndLeave = React.useCallback(() => {
    setShowPrompt(false);
    if (typeof onDiscard === 'function') {
      try {
        onDiscard();
      } catch {}
    }
    isDirtyRef.current = false;
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (typeof action === 'function') {
      action();
    }
  }, [onDiscard]);

  const UnsavedModal = React.useCallback((props) => (
    <UnsavedChangesModal
      visible={showPrompt}
      onContinueEditing={handleContinueEditing}
      onDiscardAndLeave={handleDiscardAndLeave}
      {...props}
    />
  ), [showPrompt, handleContinueEditing, handleDiscardAndLeave]);

  return {
    isDirty,
    showPrompt,
    confirmLeave,
    handleContinueEditing,
    handleDiscardAndLeave,
    UnsavedModal,
  };
}
