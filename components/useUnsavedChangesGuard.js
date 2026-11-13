import React from 'react';
import { BackHandler, Platform } from 'react-native';
import UnsavedChangesModal from './UnsavedChangesModal';

export default function useUnsavedChangesGuard({
  isDirty = false,
  isSubmitting = false,
  onDiscard,
  onSave,
  onContinueEditing,
  firstIncompleteRef,
  navigationManaged = false,
} = {}) {
  const [showPrompt, setShowPrompt] = React.useState(false);
  const [savingAndLeaving, setSavingAndLeaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  const savingRef = React.useRef(false);
  const pendingActionRef = React.useRef(null);
  const isDirtyRef = React.useRef(isDirty);
  const isSubmittingRef = React.useRef(isSubmitting);

  isDirtyRef.current = isDirty;
  isSubmittingRef.current = isSubmitting;

  // Web beforeunload protection (browser tab close / refresh)
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;

    const handleBeforeUnload = (event) => {
      if (isDirtyRef.current || isSubmittingRef.current || savingRef.current) {
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
    if (navigationManaged || Platform.OS !== 'web' || typeof window === 'undefined') return undefined;

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
  }, [navigationManaged]);

  // Hardware Back button protection on native (Android)
  React.useEffect(() => {
    if (navigationManaged || Platform.OS === 'web') return undefined;

    const handleBackPress = () => {
      if (isSubmittingRef.current) return true;
      if (isDirtyRef.current) {
        setShowPrompt(true);
        return true; // prevent default back
      }
      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    return () => subscription.remove();
  }, [navigationManaged]);

  const confirmLeave = React.useCallback((proceedAction) => {
    if (isSubmittingRef.current || savingRef.current || pendingActionRef.current) return false;
    if (!isDirtyRef.current) {
      if (typeof proceedAction === 'function') proceedAction();
      return true;
    }
    pendingActionRef.current = proceedAction;
    setSaveError('');
    setShowPrompt(true);
    return false;
  }, []);

  const handleContinueEditing = React.useCallback(() => {
    if (savingRef.current || isSubmittingRef.current) return;
    setShowPrompt(false);
    setSaveError('');
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
    if (isSubmittingRef.current || savingRef.current) return;
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

  const handleSaveAndLeave = React.useCallback(async () => {
    if (!onSave || savingRef.current || isSubmittingRef.current || !pendingActionRef.current) return;
    savingRef.current = true;
    setSavingAndLeaving(true);
    setSaveError('');
    let saved = false;
    try {
      saved = (await onSave()) === true;
    } catch {
      saved = false;
    }
    if (saved) {
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      isDirtyRef.current = false;
      setShowPrompt(false);
      savingRef.current = false;
      setSavingAndLeaving(false);
      if (typeof action === 'function') action();
      return;
    }
    setSaveError('Changes could not be saved. Check the form and try again.');
    savingRef.current = false;
    setSavingAndLeaving(false);
  }, [onSave]);

  const UnsavedModal = React.useCallback((props) => (
    <UnsavedChangesModal
      visible={showPrompt}
      onContinueEditing={handleContinueEditing}
      onDiscardAndLeave={handleDiscardAndLeave}
      onSaveAndLeave={onSave ? handleSaveAndLeave : undefined}
      saving={savingAndLeaving || isSubmitting}
      error={saveError}
      {...props}
    />
  ), [showPrompt, handleContinueEditing, handleDiscardAndLeave, handleSaveAndLeave, onSave, savingAndLeaving, isSubmitting, saveError]);

  return {
    isDirty,
    showPrompt,
    confirmLeave,
    handleContinueEditing,
    handleDiscardAndLeave,
    handleSaveAndLeave,
    UnsavedModal,
  };
}
