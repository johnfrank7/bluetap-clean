import React from 'react';
import { ActivityIndicator, AppState, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { beginRegistrationFace, evaluateRegistrationChallenge, completeRegistrationFace } from '../services/faceVerification';
import { nativeChallengeAvailable, runNativeFaceChallenge } from '../services/nativeFaceChallenge';

export default function RegistrationFaceCapture({ registrationSessionId, verification, onResult }) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [state, setState] = React.useState('ready');
  const [message, setMessage] = React.useState('');
  const [challenge, setChallenge] = React.useState(null);
  const [cameraReady, setCameraReady] = React.useState(false);
  const [pictureSize, setPictureSize] = React.useState(undefined);
  const [instruction, setInstruction] = React.useState('Position your face inside the frame');
  const [progress, setProgress] = React.useState({ completed: 0, stage: 'neutral', reason: null });
  const camera = React.useRef(null);
  const generation = React.useRef(0);
  const busy = React.useRef(false);
  const mounted = React.useRef(true);
  const permissionPending = React.useRef(false);
  const nativeReady = Platform.OS !== 'web' && nativeChallengeAvailable();
  const canAnalyze = nativeReady && !!challenge?.challengeType;
  React.useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (value) => {
      // iOS permission sheets temporarily make the app inactive; they are not
      // a cancelled capture. Actual backgrounding still invalidates the run.
      if (value === 'inactive' && permissionPending.current) return;
      if (value !== 'active') { generation.current++; busy.current = false; setState('ready'); setChallenge(null); setCameraReady(false); }
    });
    return () => { mounted.current = false; generation.current++; subscription.remove(); };
  }, []);
  const active = (value) => mounted.current && generation.current === value;
  const cancel = () => { generation.current++; busy.current = false; setState('ready'); setChallenge(null); setCameraReady(false); setMessage(''); };
  const cameraOpened = async () => {
    const attempt = generation.current;
    try {
      const sizes = await camera.current.getAvailablePictureSizesAsync();
      const candidates = sizes.map((size) => ({ size, pixels: size.split('x').map(Number).reduce((a, b) => a * b, 1) })).filter((item) => Number.isFinite(item.pixels)).sort((a, b) => a.pixels - b.pixels);
      const chosen = candidates.filter((item) => item.pixels <= 1000000).pop() || candidates[0];
      if (active(attempt) && chosen) setPictureSize(chosen.size);
    } catch { /* Size enumeration is not supported by every browser camera. */ }
    if (active(attempt)) setCameraReady(true);
  };
  const start = async () => {
    if (Platform.OS === 'web') return;
    if (busy.current) return;
    busy.current = true;
    const attempt = ++generation.current;
    setMessage(''); setState('opening'); setCameraReady(false);
    setProgress({ completed: 0, stage: 'neutral', reason: null });
    try {
      let granted;
      permissionPending.current = true;
      try {
        const currentPermission = await getPermission();
        granted = currentPermission.granted || (currentPermission.canAskAgain && (await requestPermission()).granted);
      } finally { permissionPending.current = false; }
      if (!active(attempt)) return;
      if (!granted) throw new Error('Camera access is needed for face verification. Allow access in your device or browser settings, then try again.');
      setState('camera');
      const result = await beginRegistrationFace(registrationSessionId);
      if (!active(attempt)) return;
      if (result.faceVerification) { onResult(result.faceVerification); setState('ready'); return; }
      setChallenge(result);
      if (Platform.OS !== 'web') {
        if (!nativeReady) setMessage('Native face detection requires a custom Android or iOS build. It is not available in Expo Go.');
        else if (!result.challengeType) setMessage('The face challenge service needs an update. Please try again later.');
        else if (!result.detectorAvailable) setMessage('You can complete the motion check on this device. Server-side liveness confirmation is still required before registration can continue.');
      } else if (!result.detectorAvailable) setMessage('You can position your face, but the challenge check is not available yet. Verification cannot continue.');
    } catch (error) { if (active(attempt)) { setState('failed'); setMessage(error.message); } }
    finally { if (active(attempt)) busy.current = false; }
  };
  const perform = async () => {
    if (busy.current || !cameraReady || !canAnalyze) return;
    busy.current = true;
    const attempt = generation.current;
    setState('challenge');
    const assertActive = () => { if (!active(attempt)) throw new Error('Capture cancelled.'); };
    try {
      const result = await runNativeFaceChallenge({
        challenge, assertActive,
        camera: () => camera.current,
        showInstruction: (text) => { assertActive(); setInstruction(text); },
        onProgress: (value) => { assertActive(); setProgress(value); },
        evaluate: (frames) => evaluateRegistrationChallenge(registrationSessionId, challenge.challengeId, frames),
        complete: (reference, image) => completeRegistrationFace(registrationSessionId, challenge.challengeId, reference, image),
      });
      assertActive();
      if (!result?.faceVerification) throw new Error('Face verification could not finish. Please try again.');
      onResult(result.faceVerification);
      setState(result.faceVerification.status === 'failed' ? 'failed' : 'ready');
      if (result.faceVerification.status === 'failed') setMessage("We couldn't verify your identity. Please try again.");
      setChallenge(null);
    } catch (error) { if (active(attempt)) { setState('failed'); setMessage(error.message); } }
    finally { if (active(attempt)) busy.current = false; }
  };
  if (verification.status === 'verified' && verification.duplicateCheck === 'clear' && verification.livenessPassed === true) return <View style={styles.stack}><View style={[styles.box, styles.successPanel]}><View style={[styles.icon, styles.successIcon]}><Text style={styles.successMark}>✓</Text></View><Text style={styles.title}>Identity verified</Text><Text style={styles.copy}>Your face verification was completed successfully.</Text></View><PrivacyNote /></View>;
  if (verification.status === 'review_required') return <View style={styles.stack}><View style={[styles.box, styles.reviewPanel]}><View style={[styles.icon, styles.warningIcon]}><Text style={styles.warningMark}>!</Text></View><Text style={styles.title}>Verification needs review</Text><Text style={styles.copy}>We found a possible existing registration.</Text></View><PrivacyNote /></View>;
  if (Platform.OS === 'web') return <View style={styles.stack}><View style={styles.box}><Text style={styles.title}>Continue on mobile</Text><Text style={styles.copy}>Face verification is currently available on the BlueTap mobile app.</Text><Text style={styles.copy}>Use a supported Android or iOS build to complete the face challenge. Registration can continue only after verification succeeds.</Text></View><PrivacyNote /></View>;
  const cameraVisible = state === 'camera' || state === 'challenge';
  return <View style={styles.stack}><View style={[styles.box, state === 'failed' && styles.failedPanel]}>
    {!cameraVisible && <View style={[styles.icon, state === 'failed' && styles.warningIcon]}>
      {state === 'failed' ? <Text style={styles.warningMark}>!</Text> : <View accessible={false} style={styles.faceGlyph}><View style={styles.faceHead} /><View style={styles.faceShoulders} /></View>}
    </View>}
    <Text style={styles.title}>{cameraVisible ? 'Position your face inside the frame' : state === 'failed' ? 'Verification unsuccessful' : 'Face Verification'}</Text>
    <Text style={styles.copy}>{cameraVisible ? 'Keep your face centered and follow the instruction below.' : 'Use your camera to complete a short identity check.'}</Text>
    {!cameraVisible && state !== 'failed' && state !== 'opening' && <View style={styles.benefits}>
      {['Helps prevent duplicate accounts', 'Protects your BlueTap identity', 'Takes only a few moments'].map((text) => <View key={text} style={styles.benefitRow}><Text style={styles.benefitCheck}>✓</Text><Text style={styles.benefitText}>{text}</Text></View>)}
    </View>}
    {cameraVisible && <>
      <View style={styles.preview}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" mode="picture" mute pictureSize={pictureSize}
          onCameraReady={cameraOpened}
          onMountError={() => { generation.current++; busy.current = false; setCameraReady(false); setState('failed'); setMessage('The camera could not open. Check camera access and try again.'); }} />
        <View pointerEvents="none" style={[styles.frame, state === 'challenge' && progress.reason && styles.frameWarning, state === 'challenge' && !progress.reason && progress.completed > 0 && styles.frameProgress]} />
      </View>
      <Text accessibilityLiveRegion="polite" style={styles.copy}>{state === 'challenge' ? instruction : challenge ? `Follow the instruction: ${challenge.instruction}` : 'Preparing your challenge...'}</Text>
      {state === 'challenge' && <View style={styles.progressRow} accessibilityLabel={`${progress.completed} of 3 motion steps completed`}>
        {['Look forward', 'Turn', 'Return'].map((label, index) => <View key={label} style={styles.progressStep}><View style={[styles.progressSegment, progress.completed > index && styles.progressSegmentDone]} /><Text style={styles.progressLabel}>{label}</Text></View>)}
      </View>}
      {state === 'challenge' ? <View style={styles.processing}><ActivityIndicator color="#187BCD" /><Text style={styles.processingText}>{progress.stage === 'processing' ? 'Checking your identity...' : 'Follow the motion guide'}</Text></View> : <TouchableOpacity style={[styles.button, (!cameraReady || !canAnalyze) && styles.disabled]} disabled={!cameraReady || !canAnalyze} onPress={perform}><Text style={styles.buttonText}>Begin challenge</Text></TouchableOpacity>}
      <TouchableOpacity onPress={cancel} style={styles.secondary}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>
    </>}
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.notice}>{message}</Text>}
    {!cameraVisible && <TouchableOpacity style={styles.button} disabled={state === 'opening'} onPress={start}>{state === 'opening' ? <View style={styles.processing}><ActivityIndicator color="#FFF" /><Text style={styles.buttonText}>Opening camera...</Text></View> : <Text style={styles.buttonText}>{state === 'failed' ? 'Try Again' : 'Start Face Verification'}</Text>}</TouchableOpacity>}
    {permission?.canAskAgain === false && !permission.granted && <TouchableOpacity style={styles.secondary} onPress={() => Linking.openSettings().catch(() => setMessage('Allow camera access in your browser or device settings.'))}><Text>Open settings</Text></TouchableOpacity>}
  </View><PrivacyNote /></View>;
}
function PrivacyNote() {
  return <View style={styles.privacyBox}><View style={styles.lockIcon} accessible={false}><View style={styles.lockShackle} /><View style={styles.lockBody} /></View><View style={styles.privacyContent}><Text style={styles.privacyTitle}>Privacy and security</Text><Text style={styles.privacy}>Your face check is used only for identity verification. BlueTap stores only verification metadata in your profile.</Text></View></View>;
}
const styles = StyleSheet.create({
  stack: { width: '100%', gap: 16 },
  box: { width: '100%', alignItems: 'center', gap: 12, padding: 24, backgroundColor: '#F8FBFE', borderWidth: 1, borderColor: '#DDEBF6', borderRadius: 18 },
  title: { fontSize: 19, fontWeight: '600', color: '#12304A', textAlign: 'center' },
  copy: { fontSize: 15, lineHeight: 22, color: '#4D6274', textAlign: 'center' },
  icon: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#E5F2FC', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  faceGlyph: { width: 30, height: 34, borderWidth: 1.5, borderColor: '#187BCD', borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  faceHead: { width: 10, height: 10, borderWidth: 1.5, borderColor: '#187BCD', borderRadius: 5, marginBottom: 3 },
  faceShoulders: { width: 19, height: 9, borderWidth: 1.5, borderColor: '#187BCD', borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  benefits: { alignSelf: 'stretch', gap: 8, marginVertical: 4 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  benefitCheck: { color: '#187BCD', fontSize: 14, fontWeight: '600' },
  benefitText: { flex: 1, color: '#42637C', fontSize: 14, lineHeight: 20 },
  successPanel: { backgroundColor: '#F4FBF7', borderColor: '#D7EDE0' }, successIcon: { backgroundColor: '#E0F3E8' }, successMark: { color: '#238254', fontSize: 27 },
  reviewPanel: { backgroundColor: '#FFFCF5', borderColor: '#F0E5C9' }, failedPanel: { borderColor: '#EDDCCF' }, warningIcon: { backgroundColor: '#FCEDD8' }, warningMark: { color: '#9A6525', fontSize: 25, fontWeight: '600' },
  preview: { width: '100%', maxWidth: 300, aspectRatio: 3 / 4, borderRadius: 16, overflow: 'hidden', backgroundColor: '#12304A', alignItems: 'center', justifyContent: 'center' },
  frame: { width: '70%', height: '70%', borderRadius: 160, borderWidth: 3, borderColor: '#FFF' },
  frameWarning: { borderColor: '#F7C76B' }, frameProgress: { borderColor: '#71D6B0' },
  progressRow: { width: '100%', flexDirection: 'row', gap: 8 }, progressStep: { flex: 1, gap: 4 },
  progressSegment: { height: 4, borderRadius: 2, backgroundColor: '#DDE8F1' }, progressSegmentDone: { backgroundColor: '#187BCD' }, progressLabel: { color: '#526E84', fontSize: 11, textAlign: 'center' },
  button: { width: '100%', minHeight: 50, paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: '#187BCD', borderRadius: 11, marginTop: 4 },
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '600', textAlign: 'center' }, disabled: { opacity: 0.5 },
  processing: { flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }, processingText: { color: '#315F82', fontSize: 14 },
  secondary: { padding: 12 }, secondaryText: { color: '#416581', fontSize: 14 }, notice: { color: '#8D6024', backgroundColor: '#FFF7E8', padding: 12, borderRadius: 10, fontSize: 14, textAlign: 'center', lineHeight: 21, width: '100%' },
  privacyBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#EFF6FC', borderRadius: 12, padding: 16 },
  privacyContent: { flex: 1 }, privacyTitle: { color: '#2E536F', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  privacy: { fontSize: 13, lineHeight: 20, color: '#526E84' },
  lockIcon: { width: 20, height: 24, alignItems: 'center', marginTop: 1 }, lockShackle: { width: 10, height: 10, borderWidth: 1.5, borderColor: '#6189A7', borderTopLeftRadius: 6, borderTopRightRadius: 6 }, lockBody: { width: 16, height: 12, borderWidth: 1.5, borderColor: '#6189A7', borderRadius: 3, marginTop: -3, backgroundColor: '#EFF6FC' },
});
